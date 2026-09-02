import {cached, getJson, stale} from "./cache";
import {RWA_BY_ADDRESS, RWA_REGISTRY} from "./robinhood";

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
const TTL_MS = 60_000;

export interface DexPair {
  chainId: string;
  dexId: string;
  labels?: string[];
  pairAddress: string;
  baseToken: {address: string; name: string; symbol: string};
  quoteToken: {address: string; name: string; symbol: string};
  priceUsd?: string;
  liquidity?: {usd?: number};
  volume?: {h24?: number};
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
