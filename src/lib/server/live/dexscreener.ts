import {cached, getJson, stale} from "./cache";
import {RWA_BY_ADDRESS, RWA_REGISTRY} from "./robinhood";
import {poolsForToken} from "./geckoterminal";

/**
 * DexScreener, for the community tokens only.
 *
 * For a token whose only market is a pool, the pool price *is* the price. For a
 * stock token it is not — measured against Robinhood's own quotes the median
 * error is 5.5%, because two thirds of those pools hold under $10k. So nothing
 * here is allowed to set an RWA price; see `robinhood.ts` for that.
 *
 * Free and unauthenticated: 30 addresses per request, ~300 requests a minute.
 * TODO(live): no SLA and no commercial terms. Part 05 keeps the on-chain
 * factory scan as the path that does not depend on them.
 */

const BASE = "https://api.dexscreener.com/tokens/v1/robinhood";
const BATCH = 30;
const TTL_MS = 15_000;

export interface DexPair {
  chainId: string;
  dexId: string;
  labels?: string[];
  pairAddress: string;
  baseToken: {address: string; name: string; symbol: string};
  quoteToken: {address: string; name: string; symbol: string};
  priceUsd?: string;
  liquidity?: {usd?: number};
  volume?: {m5?: number; h1?: number; h6?: number; h24?: number};
  priceChange?: {m5?: number; h1?: number; h6?: number; h24?: number};
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: {imageUrl?: string; websites?: {url: string}[]; socials?: {type: string; url: string}[]};
}

async function loadPairs(addresses: string[]): Promise<DexPair[]> {
  const out: DexPair[] = [];

  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH).join(",");
    try {
      const body = await getJson<DexPair[] | {pairs?: DexPair[]}>(
        `${BASE}/${batch}`,
        8000,
      );
      out.push(...(Array.isArray(body) ? body : (body.pairs ?? [])));
    } catch {
      // A failed batch costs 30 tokens, not the whole feed.
    }
  }

  return out;
}

/**
 * Every pool DexScreener knows for one token.
 *
 * `tokens/v1` and the search both cap what they return, so the pool discovery
 * that builds the feed sees only a subset — enough to list a token, but not
 * enough to be sure which of its pools is deepest. This endpoint is per-token
 * and complete: AI trades in thirty pools and the feed pass saw a handful.
 *
 * That gap was not theoretical. UBIK's deepest market is its USDG pool at
 * $321k, and the app was reading trades and candles from its $282k GLD pool
 * because that was the deepest one discovery happened to return.
 */
export async function pairsForToken(address: string): Promise<DexPair[]> {
  const key = `ds:token:${address.toLowerCase()}`;
  try {
    const loaded = await cached(key, TTL_MS, async () => {
      const body = await getJson<DexPair[] | {pairs?: DexPair[]}>(
        `https://api.dexscreener.com/token-pairs/v1/robinhood/${address}`,
      );
      return Array.isArray(body) ? body : (body.pairs ?? []);
    });
    if (loaded.length > 0) return loaded;
  } catch (error) {
    console.error("token pairs failed", error);
  }
  return stale<DexPair[]>(key) ?? [];
}

/**
 * Every pool of every stock token, enumerated one ticker at a time.
 *
 * The batched `tokens/v1` endpoint takes thirty addresses but caps the
 * *response*, so asking it about the whole registry returns a fraction of what
 * exists — and the fraction is not the deepest pools, just the first ones it
 * felt like sending. Measured against the per-token endpoint, the feed built
 * that way held 60 tokens while 40 stock tickers alone accounted for 224.
 *
 * So this walks the registry instead: one request per ticker, up to thirty
 * pools each, which is complete enough that a new pair shows up on the next
 * refresh rather than whenever discovery happens to notice it.
 */
const SWEEP_CONCURRENCY = 10;
const SWEEP_TTL_MS = 5 * 60_000;

/**
 * `token-pairs/v1/robinhood/<address>` caps at exactly this many pairs and
 * gives no pagination — silently, with no error or truncation flag. Measured
 * against real RWAs: roughly a quarter of them have more community pairs than
 * this and lose the rest. A count that lands exactly here is the only signal
 * that pairs were cut.
 */
const PER_TOKEN_CAP = 30;

export async function allRwaPairs(): Promise<DexPair[]> {
  const key = "ds:sweep";

  const load = async () => {
    {
      const addresses = RWA_REGISTRY.map((entry) => entry.address);
      const seen = new Map<string, DexPair>();
      const capped: string[] = [];
      let index = 0;

      async function worker() {
        while (index < addresses.length) {
          const address = addresses[index++];
          try {
            const body = await getJson<DexPair[] | {pairs?: DexPair[]}>(
              `https://api.dexscreener.com/token-pairs/v1/robinhood/${address}`,
              9000,
            );
            const pairs = Array.isArray(body) ? body : (body.pairs ?? []);
            for (const pair of pairs) {
              if (pair?.pairAddress) seen.set(pair.pairAddress, pair);
            }
            if (pairs.length === PER_TOKEN_CAP) capped.push(address);
          } catch {
            // One ticker failing costs its pools, not the sweep.
          }
        }
      }

      await Promise.all(
        Array.from(
          {length: Math.min(SWEEP_CONCURRENCY, addresses.length)},
          worker,
        ),
      );

      // A capped ticker is missing an unknown number of pairs — that is what
      // cost HARAM/BE its place in the feed, in search, and on the New tab,
      // despite trading at a quarter-million dollars of liquidity: BE's own
      // 30-pair page simply did not reach it.
      //
      // Recovered from CoinGecko's onchain API when a paid key is configured —
      // measured as genuinely paginated, no cap found in practice, and it is
      // what actually found HARAM/BE. DexScreener's own search was tried first
      // and rejected: searching a short, generic ticker like "BE" ranks
      // unrelated pairs above the one actually missing, so it recovered pairs
      // for *some* capped tickers but not this one — the exact case this
      // exists to fix. Skipped without a key: sweeping dozens of capped
      // tickers at several pages each against the free, ~30-request-a-minute
      // endpoint would exhaust it by itself.
      let recovered = 0;
      let capIndex = 0;

      async function capWorker() {
        while (capIndex < capped.length) {
          const address = capped[capIndex++];
          try {
            const pools = await poolsForToken(address, 4);
            for (const pool of pools) {
              if (seen.has(pool.pairAddress)) continue;
              seen.set(pool.pairAddress, pool);
              recovered++;
            }
          } catch {
            // Recovery is best-effort; the capped 30 already went in.
          }
        }
      }

      if (capped.length > 0) {
        await Promise.all(
          Array.from(
            {length: Math.min(SWEEP_CONCURRENCY, capped.length)},
            capWorker,
          ),
        );
        console.info(
          `rwa pair sweep: ${capped.length} tickers hit the ${PER_TOKEN_CAP}-pair cap, recovered ${recovered} additional pairs via CoinGecko`,
        );
      }

      return [...seen.values()];
    }
  };

  // Deliberately blocking on a cold cache. Returning early while the sweep ran
  // behind the request made a cold instance publish a partial feed, and with
  // the result now shared across instances that partial build is what everyone
  // would read until it revalidated. One slow request is better than a feed
  // that is missing most of the chain.

  try {
    const loaded = await cached(key, SWEEP_TTL_MS, load);
    if (loaded.length > 0) return loaded;
  } catch (error) {
    console.error("rwa pair sweep failed", error);
  }

  return stale<DexPair[]>(key) ?? [];
}

/**
 * Every pool with a stock token on one side, deduplicated.
 *
 * Enumerated from the RWA side rather than by scanning the chain, which makes
 * the set complete by construction: a token with an RWA pair cannot hide,
 * because the pair is what makes it visible.
 */
export async function rwaPairs(): Promise<DexPair[]> {
  const key = "ds:pairs";
  try {
    const loaded = await cached(key, TTL_MS, async () => {
      const pairs = await loadPairs(RWA_REGISTRY.map((entry) => entry.address));
      const seen = new Map<string, DexPair>();
      for (const pair of pairs) {
        if (!seen.has(pair.pairAddress)) seen.set(pair.pairAddress, pair);
      }
      return [...seen.values()];
    });
    if (loaded.length > 0) return loaded;
  } catch {
    // fall through
  }
  return stale<DexPair[]>(key) ?? [];
}

export interface PairSide {
  pair: DexPair;
  /** The stock token in this pool. */
  rwaTicker: string;
  /** The other side — the tradeable community token. */
  token: {address: string; name: string; symbol: string};
  /** True when the community token is the base, so `priceUsd` describes it. */
  tokenIsBase: boolean;
}

/**
 * Splits a pool into its RWA side and its token side.
 *
 * Returns null for pools that are RWA against RWA, or against a quote asset
 * like USDG — those are not community tokens and have no place in the token
 * feed, though the RWA side of them is exactly where the deepest liquidity is.
 */
export function classify(pair: DexPair): PairSide | null {
  const base = pair.baseToken?.address?.toLowerCase();
  const quote = pair.quoteToken?.address?.toLowerCase();
  if (!base || !quote) return null;

  const baseRwa = RWA_BY_ADDRESS.get(base);
  const quoteRwa = RWA_BY_ADDRESS.get(quote);

  if (baseRwa && quoteRwa) return null;
  if (!baseRwa && !quoteRwa) return null;

  const rwa = baseRwa ?? quoteRwa!;
  const token = baseRwa ? pair.quoteToken : pair.baseToken;

  return {
    pair,
    rwaTicker: rwa.ticker,
    token,
    tokenIsBase: !baseRwa,
  };
}

/**
 * A price series from the change buckets DexScreener returns.
 *
 * Four real observations — 24h, 6h, 1h and 5m ago — plus the current price.
 * Coarse, but every point is a price that actually existed, which a smooth
 * interpolation between two endpoints would not be. Returns an empty array
 * rather than inventing shape when the buckets are missing.
 */
export function seriesFrom(pair: DexPair): number[] {
  const now = Number(pair.priceUsd ?? 0);
  if (!Number.isFinite(now) || now <= 0) return [];

  const change = pair.priceChange;
  if (!change) return [];

  const at = (pct: number | undefined) =>
    typeof pct === "number" && Number.isFinite(pct) && 1 + pct / 100 !== 0
      ? now / (1 + pct / 100)
      : null;

  const points = [at(change.h24), at(change.h6), at(change.h1), at(change.m5), now];
  const usable = points.filter((v): v is number => v !== null && v > 0);

  return usable.length >= 2 ? usable : [];
}

/** Socials in the shape the token page expects. */
export function socialsFrom(pair: DexPair) {
  const socials = pair.info?.socials ?? [];
  const find = (type: string) =>
    socials.find((s) => s.type?.toLowerCase() === type)?.url ?? null;

  return {
    x: find("twitter") ?? find("x"),
    telegram: find("telegram"),
    discord: find("discord"),
    website: pair.info?.websites?.[0]?.url ?? null,
  };
}

/**
 * The quote assets on this chain. A pool against one of these is a market in
 * the token, not a pairing between two assets we list.
 */
export const QUOTE_ASSETS = new Map<string, string>([
  ["0x5fc5360d0400a0fd4f2af552add042d716f1d168", "USDG"],
  ["0x0bd7d308f8e1639fab988df18a8011f41eacad73", "WETH"],
  ["0x0000000000000000000000000000000000000000", "ETH"],
]);

/** Symbols longer than this are spam trying to fill the row. */
const MAX_SYMBOL = 15;

const SEARCH_QUERIES = ["robinhood USDG", "robinhood WETH", "robinhood chain token"];

/**
 * Community tokens on the chain, found through search.
 *
 * There is no endpoint that lists a chain's tokens, and `tokens/v1` caps its
 * response, so discovery is a handful of searches deduplicated by pair. It is
 * not provably complete — the on-chain factory scan in Part 05 is what makes it
 * so — but it finds what is liquid, which is what anyone will trade.
 */
export async function communityPairs(): Promise<DexPair[]> {
  const key = "ds:community";
  try {
    const loaded = await cached(key, TTL_MS, async () => {
      const seen = new Map<string, DexPair>();
      for (const q of SEARCH_QUERIES) {
        try {
          const body = await getJson<{pairs?: DexPair[]}>(
            `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
            8000,
          );
          for (const pair of body.pairs ?? []) {
            if (pair.chainId !== "robinhood") continue;
            if (!seen.has(pair.pairAddress)) seen.set(pair.pairAddress, pair);
          }
        } catch {
          // One query failing still leaves the others.
        }
      }
      return [...seen.values()];
    });
    if (loaded.length > 0) return loaded;
  } catch {
    // fall through
  }
  return stale<DexPair[]>(key) ?? [];
}

export interface CommunityToken {
  pair: DexPair;
  token: {address: string; name: string; symbol: string};
  /** What it trades against — a quote asset symbol, or an RWA ticker. */
  quoteSymbol: string;
  /** True when the other side is an actual stock token rather than USDG or ETH. */
  rwaPaired: boolean;
}

/**
 * A pool's community-token side, or null if there is not one.
 *
 * Rejects RWA-against-RWA, quote-against-quote, and anything whose symbol is
 * long enough to be an attempt at filling the row with noise.
 */
export function community(pair: DexPair): CommunityToken | null {
  const base = pair.baseToken?.address?.toLowerCase();
  const quote = pair.quoteToken?.address?.toLowerCase();
  if (!base || !quote) return null;

  const baseRwa = RWA_BY_ADDRESS.get(base);
  const quoteRwa = RWA_BY_ADDRESS.get(quote);
  const baseQuoteAsset = QUOTE_ASSETS.get(base);
  const quoteQuoteAsset = QUOTE_ASSETS.get(quote);

  // The token side is whichever end is neither a stock token nor a quote asset.
  let token: DexPair["baseToken"] | null = null;
  let against: string | null = null;
  let rwaPaired = false;

  if (!baseRwa && !baseQuoteAsset && (quoteRwa || quoteQuoteAsset)) {
    token = pair.baseToken;
    against = quoteRwa?.ticker ?? quoteQuoteAsset!;
    rwaPaired = Boolean(quoteRwa);
  } else if (!quoteRwa && !quoteQuoteAsset && (baseRwa || baseQuoteAsset)) {
    // The pool quotes the other way round, so `priceUsd` describes the wrong
    // side. Skipped rather than inverted on a guess.
    return null;
  }

  if (!token || !against) return null;
  if (!token.symbol || token.symbol.length > MAX_SYMBOL) return null;

  return {pair, token, quoteSymbol: against, rwaPaired};
}
