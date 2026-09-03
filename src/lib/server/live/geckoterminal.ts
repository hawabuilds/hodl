import type {ChartPoint, Timeframe, Trade} from "@/lib/types";
import {cached, stale} from "./cache";

/**
 * GeckoTerminal, for chart history and the trade tape.
 *
 * This is the answer to a problem that looked like it needed a paid RPC. Both
 * the candles and the tape would otherwise come from scanning `Swap` logs, and
 * the Alchemy plan in use caps `eth_getLogs` at a ten-block range against a head
 * above fifty million — a backfill would have been millions of requests.
 *
 * GeckoTerminal has already done that indexing. Its daily candles for this
 * chain reach back to 20 July 2026, which is as far back as the chain goes, so
 * charts are complete on the first render rather than filling in from empty.
 *
 * Runs against the paid CoinGecko onchain API when a key is configured, and
 * against the free GeckoTerminal endpoint when one is not. The two serve the
 * same paths under different origins, so only the base and the auth header
 * differ — everything below is written once.
 *
 * The key is what makes the tape watchable. Unauthenticated the ceiling is
 * roughly thirty calls a minute for the whole app, which two open pools can
 * exhaust on their own; the rejections that follow come back as an empty tape
 * rather than an error, which is indistinguishable from a quiet pool.
 */

/** Set to a CoinGecko API key to use the paid tier. */
const API_KEY = process.env.COINGECKO_API_KEY?.trim();

/**
 * Demo keys live on a different host to paid ones and are rejected by the
 * other, so the plan is explicit rather than guessed from the key's shape.
 */
const IS_DEMO = process.env.COINGECKO_API_PLAN?.trim().toLowerCase() === "demo";

const BASE = API_KEY
  ? IS_DEMO
    ? "https://api.coingecko.com/api/v3/onchain"
    : "https://pro-api.coingecko.com/api/v3/onchain"
  : "https://api.geckoterminal.com/api/v2";

function authHeaders(): Record<string, string> {
  if (!API_KEY) return {};
  return {[IS_DEMO ? "x-cg-demo-api-key" : "x-cg-pro-api-key"]: API_KEY};
}

/** Whether the paid tier is in use, which is what the cache windows key off. */
export const AUTHENTICATED = Boolean(API_KEY);

const NETWORK = "robinhood";

const CANDLE_TTL_MS = API_KEY ? 20_000 : 60_000;
/**
 * The tape's cache window.
 *
 * The trades panel is meant to be watched the way an explorer's is, so on a
 * paid key this sits at two seconds — roughly thirty calls a minute for a pool
 * someone has open, against a ceiling in the hundreds.
 *
 * The chain head is polled every two seconds; keep the indexer on the same
 * cadence when a paid key is configured so neither source goes stale.
 */
const TRADE_TTL_MS = API_KEY ? 2_000 : 12_000;
const POOL_TTL_MS = 30 * 60_000;
/** GeckoTerminal returns up to 300 fills per pool; cache the full page. */
const TRADES_PAGE = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A GET that treats 429 as "wait", not "fail".
 *
 * The free tier is shared and bursty, so a rejected call is routine rather than
 * exceptional. Three attempts with a widening pause covers it; beyond that the
 * caller falls back to whatever it had.
 */
async function get<T>(path: string, attempts = 3): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {accept: "application/json", ...authHeaders()},
        cache: "no-store",
      });
      if (res.status === 429) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        // Worth saying out loud: a rejected key otherwise looks exactly like a
        // quiet pool, and the app would run on the paid path returning nothing.
        console.error(
          `coingecko rejected the API key (${res.status}) — check COINGECKO_API_KEY and COINGECKO_API_PLAN`,
        );
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      if (attempt === attempts - 1) return null;
      await sleep(500);
    }
  }
  return null;
}

interface PoolsResponse {
  data?: {
    attributes?: {
      address?: string;
      name?: string;
      reserve_in_usd?: string;
      volume_usd?: {h24?: string};
    };
  }[];
}

/**
 * The deepest pool GeckoTerminal knows for a token.
 *
 * Cached for half an hour — which pool is deepest changes on the timescale of
 * liquidity migrations, not page loads.
 */
export async function deepestPool(token: string): Promise<string | null> {
  const key = `gt:pool:${token.toLowerCase()}`;
  const load = async () => {
    const body = await get<PoolsResponse>(
      `/networks/${NETWORK}/tokens/${token}/pools`,
    );
    const first = body?.data?.[0]?.attributes?.address;
    return first ?? "";
  };

  try {
    const found = await cached(key, POOL_TTL_MS, load);
    if (found) return found;
  } catch {
    // fall through
  }
  return stale<string>(key) || null;
}

/**
 * The shape `dexscreener.ts` builds the feed out of. Duplicated rather than
 * imported from there, because that file needs to call *this* one to recover
 * pairs DexScreener's own cap drops — importing the type back would make the
 * two modules depend on each other.
 */
export interface OnchainPool {
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
}

interface TokenPoolsResponse {
  data?: {
    attributes?: {
      address?: string;
      base_token_price_usd?: string;
      reserve_in_usd?: string;
      market_cap_usd?: string;
      fdv_usd?: string;
      pool_created_at?: string;
      volume_usd?: {m5?: string; h1?: string; h6?: string; h24?: string};
      price_change_percentage?: {m5?: string; h1?: string; h6?: string; h24?: string};
    };
    relationships?: {
      base_token?: {data?: {id?: string}};
      quote_token?: {data?: {id?: string}};
    };
  }[];
  included?: {
    id?: string;
    attributes?: {address?: string; name?: string; symbol?: string};
  }[];
}

/** Strips the `<network>_` prefix CoinGecko puts on every relationship id. */
function tokenIdToAddress(id: string | undefined): string {
  return (id ?? "").replace(`${NETWORK}_`, "").toLowerCase();
}

/**
 * Every pool CoinGecko knows for one token, paginated.
 *
 * `token-pairs/v1` on DexScreener caps at thirty pools and does not say so —
 * the only tell is a response that lands on exactly thirty. This exists to
 * recover what that cap drops: paid CoinGecko's onchain API serves the same
 * data twenty pools to a page with no cap found in practice, at the cost of
 * one request per page instead of one per token.
 *
 * Requires a paid key. The free GeckoTerminal endpoint enforces roughly thirty
 * requests a minute across the whole app, and sweeping even a few dozen capped
 * tickers at several pages each would exhaust that on its own — worse than the
 * gap it would be trying to close.
 */
export async function poolsForToken(
  address: string,
  maxPages = 3,
): Promise<OnchainPool[]> {
  if (!API_KEY) return [];

  const out: OnchainPool[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let body: TokenPoolsResponse | null;
    try {
      const res = await fetch(
        `${BASE}/networks/${NETWORK}/tokens/${address}/pools?page=${page}&include=base_token,quote_token`,
        {headers: {accept: "application/json", ...authHeaders()}, cache: "no-store"},
      );
      if (!res.ok) break;
      body = (await res.json()) as TokenPoolsResponse;
    } catch {
      break;
    }

    const rows = body?.data ?? [];
    if (rows.length === 0) break;

    const tokens = new Map(
      (body?.included ?? []).map((entry) => [
        entry.id ?? "",
        entry.attributes ?? {},
      ]),
    );

    for (const row of rows) {
      const a = row.attributes;
      if (!a?.address) continue;

      const baseId = row.relationships?.base_token?.data?.id;
      const quoteId = row.relationships?.quote_token?.data?.id;
      const baseMeta = tokens.get(baseId ?? "");
      const quoteMeta = tokens.get(quoteId ?? "");
      const baseAddress = tokenIdToAddress(baseId);
      const quoteAddress = tokenIdToAddress(quoteId);
      if (!baseAddress || !quoteAddress) continue;

      const num = (value: string | undefined) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      };

      out.push({
        chainId: NETWORK,
        dexId: "uniswap",
        // Version detection elsewhere in the app goes by address shape — a
        // 32-byte value is a v4 pool id, a 20-byte one a v3 pool address — so
        // this only needs to match that same convention for the description
        // string that reads it, not carry separate logic.
        labels: /^0x[0-9a-f]{64}$/i.test(a.address) ? ["v4"] : ["v3"],
        pairAddress: a.address,
        baseToken: {
          address: baseAddress,
          name: baseMeta?.name ?? "",
          symbol: baseMeta?.symbol ?? "",
        },
        quoteToken: {
          address: quoteAddress,
          name: quoteMeta?.name ?? "",
          symbol: quoteMeta?.symbol ?? "",
        },
        priceUsd: a.base_token_price_usd,
        liquidity: {usd: num(a.reserve_in_usd)},
        volume: {
          m5: num(a.volume_usd?.m5),
          h1: num(a.volume_usd?.h1),
          h6: num(a.volume_usd?.h6),
          h24: num(a.volume_usd?.h24),
        },
        priceChange: {
          m5: num(a.price_change_percentage?.m5),
          h1: num(a.price_change_percentage?.h1),
          h6: num(a.price_change_percentage?.h6),
          h24: num(a.price_change_percentage?.h24),
        },
        marketCap: num(a.market_cap_usd),
        fdv: num(a.fdv_usd),
        pairCreatedAt: a.pool_created_at
          ? Date.parse(a.pool_created_at)
          : undefined,
      });
    }

    // A page short of twenty is the last one; no point asking again.
    if (rows.length < 20) break;
  }

  return out;
}

/** How each of the app's timeframes maps onto GeckoTerminal's buckets. */
const BUCKETS: Record<Timeframe, {path: string; aggregate?: number}> = {
  "5m": {path: "minute", aggregate: 5},
  "15m": {path: "minute", aggregate: 15},
  "1h": {path: "hour"},
  "4h": {path: "hour", aggregate: 4},
  "1D": {path: "day"},
};

interface OhlcvResponse {
  data?: {attributes?: {ohlcv_list?: number[][]}};
}

/**
 * Candles for a pool, oldest first, in the shape `PriceChart` already takes.
 *
 * Only the close is used — the component draws a line, not a candlestick — but
 * the full OHLC is what the endpoint returns and what a candlestick chart would
 * need if one is ever added.
 */
export async function candles(
  pool: string,
  timeframe: Timeframe,
  limit = 120,
): Promise<ChartPoint[]> {
  const bucket = BUCKETS[timeframe];
  const key = `gt:ohlcv:${pool}:${timeframe}`;

  const load = async (): Promise<ChartPoint[]> => {
    const params = new URLSearchParams({limit: String(limit)});
    if (bucket.aggregate) params.set("aggregate", String(bucket.aggregate));

    const body = await get<OhlcvResponse>(
      `/networks/${NETWORK}/pools/${pool}/ohlcv/${bucket.path}?${params}`,
    );

    const list = body?.data?.attributes?.ohlcv_list ?? [];
    return list
      // [timestamp, open, high, low, close, volume], newest first.
      .map(([seconds, , , , close]) => ({t: seconds * 1000, price: close}))
      .filter((point) => Number.isFinite(point.price) && point.price > 0)
      .reverse();
  };

  try {
    const loaded = await cached(key, CANDLE_TTL_MS, load);
    if (loaded.length > 0) return loaded;
  } catch {
    // fall through
  }
  return stale<ChartPoint[]>(key) ?? [];
}

interface TradesResponse {
  data?: {
    /** `network_block_tx_logIndex_timestamp`. The log index makes a fill unique. */
    id?: string;
    attributes?: {
      block_number?: number;
      tx_hash?: string;
      tx_from_address?: string;
      from_token_amount?: string;
      to_token_amount?: string;
      price_from_in_usd?: string;
      price_to_in_usd?: string;
      block_timestamp?: string;
      kind?: string;
      volume_in_usd?: string;
      from_token_address?: string;
    };
  }[];
}

/**
 * Recent fills for a pool, newest first.
 *
 * The `token` query param makes `kind` buy or sell from that token's point of
 * view, which is what the tape needs when the page token is the pool's quote
 * side rather than its base.
 */
export async function trades(
  pool: string,
  /** The asset whose page this is, so amounts describe the right side. */
  tokenAddress: string,
  limit = 40,
): Promise<Trade[]> {
  const wanted = tokenAddress.toLowerCase();
  const key = `gt:trades:${pool}:${wanted}`;

  const load = async (): Promise<Trade[]> => {
    const params = new URLSearchParams({
      token: wanted,
      limit: String(TRADES_PAGE),
    });
    const body = await get<TradesResponse>(
      `/networks/${NETWORK}/pools/${pool}/trades?${params}`,
    );
    if (!body) throw new Error("trades upstream unavailable");

    return (body.data ?? [])
      .map((row): Trade | null => {
        const a = row.attributes;
        if (!a?.tx_hash || !a.block_timestamp) return null;

        // With `?token=`, kind is buy/sell from this token's point of view.
        const buy = a.kind === "buy";
        const amountUsd = Number(a.volume_in_usd ?? 0);
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

        // The trade is written from one token to another. Which amount belongs
        // to this page depends on which side of the swap our token sat on.
        const fromIsOurs = (a.from_token_address ?? "").toLowerCase() === wanted;
        const amount = Number(
          fromIsOurs ? a.from_token_amount : a.to_token_amount,
        );
        const priceUsd = Number(
          fromIsOurs ? a.price_from_in_usd : a.price_to_in_usd,
        );

        // The indexer's own id is `network_block_tx_logIndex_timestamp`, and
        // that log index is what makes a fill unique: this chain has pools
        // where a single transaction carries ten swaps, so a transaction hash
        // identifies a batch rather than a trade. Keying on it lets the chain
        // read and the indexer agree on which fill is which.
        const logPart = String(row.id ?? "").split("_")[3];
        const logNum = logPart
          ? logPart.startsWith("0x")
            ? parseInt(logPart, 16)
            : parseInt(logPart, 10)
          : NaN;
        const logIndex = Number.isFinite(logNum) ? String(logNum) : null;

        return {
          id: logIndex
            ? `${a.tx_hash}-${logIndex}`
            : `${a.tx_hash}-${a.block_number ?? 0}`,
          side: buy ? "buy" : "sell",
          amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
          amountUsd,
          priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : 0,
          maker: a.tx_from_address ?? "0x",
          txHash: a.tx_hash,
          makerHandle: null,
          at: a.block_timestamp,
        };
      })
      .filter((trade): trade is Trade => trade !== null);
  };

  try {
    const loaded = await cached(key, TRADE_TTL_MS, load);
    if (loaded.length > 0) return loaded.slice(0, limit);
  } catch {
    // fall through
  }

  const previous = stale<Trade[]>(key);
  if (previous && previous.length > 0) return previous.slice(0, limit);
  return [];
}
