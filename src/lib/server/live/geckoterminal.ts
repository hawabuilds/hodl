import type {ChartPoint, Timeframe, Trade} from "@/lib/types";
import type {DexPair} from "./dexscreener";
import {cached, stale} from "./cache";
import {
  applyKeyUsage,
  geckoCreditLogFields,
  markKeyPolled,
  recordGeckoCall,
  shouldFallbackToFree,
  shouldPollKey,
  type GeckoCaller,
} from "./geckoCredits";

/**
 * GeckoTerminal / CoinGecko onchain.
 *
 * Pro is for historical candles only. Discovery, images, holders and the tape
 * use the free GeckoTerminal host. A 194-ticker Pro sweep every five minutes
 * is what drained the last plan; that path is gone.
 *
 * On 429 / 401 / 403 the candle path falls through to the free host in the
 * same request. There is no sleep-and-retry loop — those sat a request at
 * ~30s and still returned a silent blank.
 */

/** Set to a CoinGecko API key to use the paid tier for candles. */
const API_KEY = process.env.COINGECKO_API_KEY?.trim();

/**
 * Demo keys live on a different host to paid ones and are rejected by the
 * other, so the plan is explicit rather than guessed from the key's shape.
 */
const IS_DEMO = process.env.COINGECKO_API_PLAN?.trim().toLowerCase() === "demo";

export const FREE_GECKO_BASE = "https://api.geckoterminal.com/api/v2";
export const PRO_GECKO_BASE = IS_DEMO
  ? "https://api.coingecko.com/api/v3/onchain"
  : "https://pro-api.coingecko.com/api/v3/onchain";
const KEY_URL = IS_DEMO
  ? "https://api.coingecko.com/api/v3/key"
  : "https://pro-api.coingecko.com/api/v3/key";

const FETCH_MS = 8_000;

function authHeaders(): Record<string, string> {
  if (!API_KEY) return {};
  return {[IS_DEMO ? "x-cg-demo-api-key" : "x-cg-pro-api-key"]: API_KEY};
}

/** Whether a Pro/demo key is configured. Cache windows still key off this. */
export const AUTHENTICATED = Boolean(API_KEY);

const NETWORK = "robinhood";

const CANDLE_TTL_MS = API_KEY ? 20_000 : 60_000;
/** Tape is Alchemy-first. Gecko trades, when used, hit the free host. */
const TRADE_TTL_MS = 12_000;
const POOL_TTL_MS = 30 * 60_000;
const MEGAFILTER_TTL_MS = 30 * 60_000;
const POOLS_PAGE_SIZE = 20;
const POOLS_MAX_PAGES = 50;
const MEGAFILTER_MAX_PAGES = 100;
const MIN_POOL_LIQUIDITY_USD = 1_000;
/** GeckoTerminal returns up to 300 fills per pool; cache the full page. */
const TRADES_PAGE = 300;

export interface GeckoGet<T> {
  data: T | null;
  error: string | null;
  host: "pro" | "free" | null;
}

async function fetchOnce<T>(
  base: string,
  path: string,
  headers: Record<string, string>,
): Promise<{status: number; body: T | null}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      headers: {accept: "application/json", ...headers},
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return {status: res.status, body: null};
    return {status: res.status, body: (await res.json()) as T};
  } catch {
    return {status: 0, body: null};
  } finally {
    clearTimeout(timer);
  }
}

async function refreshKeyUsage(): Promise<void> {
  if (!API_KEY || !shouldPollKey()) return;
  markKeyPolled();
  try {
    const res = await fetch(KEY_URL, {
      headers: {accept: "application/json", ...authHeaders()},
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as {
      monthly_call_credit?: number;
      current_remaining_monthly_calls?: number;
    };
    applyKeyUsage(body);
    console.info("coingecko key usage", geckoCreditLogFields());
  } catch (error) {
    console.error("coingecko /key poll failed", error);
  }
}

/**
 * One Pro attempt (candles only), then free. No sleep retries.
 *
 * `tier: "free"` never touches Pro — that is the market sweep / tape / images.
 */
async function get<T>(
  path: string,
  opts: {caller: GeckoCaller; tier?: "auto" | "free"},
): Promise<GeckoGet<T>> {
  const tryPro = opts.tier !== "free" && Boolean(API_KEY);

  if (tryPro) {
    void refreshKeyUsage();
    const pro = await fetchOnce<T>(PRO_GECKO_BASE, path, authHeaders());
    recordGeckoCall(opts.caller, "pro");
    console.info("gecko pro", {
      caller: opts.caller,
      status: pro.status,
      ...geckoCreditLogFields(),
    });
    if (pro.body) return {data: pro.body, error: null, host: "pro"};
    if (shouldFallbackToFree(pro.status) || pro.status === 0) {
      console.warn("coingecko pro rejected; falling back to free host", {
        caller: opts.caller,
        status: pro.status,
      });
    } else {
      return {
        data: null,
        error: `CoinGecko returned ${pro.status || "a network error"}.`,
        host: "pro",
      };
    }
  }

  const free = await fetchOnce<T>(FREE_GECKO_BASE, path, {});
  recordGeckoCall(opts.caller, "free");
  if (free.body) return {data: free.body, error: null, host: "free"};
  const status = free.status;
  const error =
    status === 429
      ? "GeckoTerminal is rate-limited. Retry in a moment."
      : status === 0
        ? "Could not reach GeckoTerminal."
        : `GeckoTerminal returned ${status}.`;
  return {data: null, error, host: "free"};
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
      {caller: "other", tier: "free"},
    );
    const first = body.data?.data?.[0]?.attributes?.address;
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
  priceNative?: string;
  quotePriceUsd?: string;
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
      quote_token_price_usd?: string;
      base_token_price_native_currency?: string;
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

function num(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Base priced in quote tokens. Used to invert when our token is the quote. */
function nativePrice(
  baseUsd: string | undefined,
  quoteUsd: string | undefined,
  native: string | undefined,
): string | undefined {
  if (native && Number(native) > 0) return native;
  const base = Number(baseUsd);
  const quote = Number(quoteUsd);
  if (base > 0 && quote > 0) return String(base / quote);
  return undefined;
}

function poolRowToOnchain(
  row: NonNullable<TokenPoolsResponse["data"]>[number],
  tokens: Map<string, {address?: string; name?: string; symbol?: string}>,
): OnchainPool | null {
  const a = row.attributes;
  if (!a?.address) return null;

  const baseId = row.relationships?.base_token?.data?.id;
  const quoteId = row.relationships?.quote_token?.data?.id;
  const baseMeta = tokens.get(baseId ?? "");
  const quoteMeta = tokens.get(quoteId ?? "");
  const baseAddress = tokenIdToAddress(baseId);
  const quoteAddress = tokenIdToAddress(quoteId);
  if (!baseAddress || !quoteAddress) return null;

  return {
    chainId: NETWORK,
    dexId: "uniswap",
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
    quotePriceUsd: a.quote_token_price_usd,
    priceNative: nativePrice(a.base_token_price_usd, a.quote_token_price_usd, a.base_token_price_native_currency),
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
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : undefined,
  };
}

function parsePoolsBody(body: TokenPoolsResponse | null): OnchainPool[] {
  const rows = body?.data ?? [];
  if (rows.length === 0) return [];

  const tokens = new Map(
    (body?.included ?? []).map((entry) => [entry.id ?? "", entry.attributes ?? {}]),
  );

  const out: OnchainPool[] = [];
  for (const row of rows) {
    const pool = poolRowToOnchain(row, tokens);
    if (pool) out.push(pool);
  }
  return out;
}

async function fetchPoolsPage(path: string): Promise<OnchainPool[]> {
  const fetched = await get<TokenPoolsResponse>(path, {
    caller: "sweep",
    tier: "free",
  });
  return parsePoolsBody(fetched.data);
}

/** CoinGecko pool rows in the shape the feed already consumes. */
export function onchainPoolToDexPair(pool: OnchainPool): DexPair {
  return {...pool};
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
  return poolsForTokenAllPages(address, maxPages);
}

/**
 * One page of pools from the public GeckoTerminal endpoint.
 *
 * DexScreener's per-token route is empty for some V4 / RWA-paired memecoins
 * (SPACEHOOD). A single public page is enough to recover orientation.
 */
export async function poolsForTokenPublic(address: string): Promise<OnchainPool[]> {
  return fetchPoolsPage(
    `/networks/${NETWORK}/tokens/${address.toLowerCase()}/pools?page=1&include=base_token,quote_token`,
  );
}

/** Full pagination — stops when a page is short or empty. */
export async function poolsForTokenAllPages(
  address: string,
  maxPages = POOLS_MAX_PAGES,
): Promise<OnchainPool[]> {
  if (!API_KEY) return [];

  const out: OnchainPool[] = [];
  const wanted = address.toLowerCase();

  for (let page = 1; page <= maxPages; page++) {
    const pagePools = await fetchPoolsPage(
      `/networks/${NETWORK}/tokens/${wanted}/pools?page=${page}&include=base_token,quote_token`,
    );
    if (pagePools.length === 0) break;
    out.push(...pagePools);
    if (pagePools.length < POOLS_PAGE_SIZE) break;
  }

  return out;
}

/**
 * Disabled. This was 194 tickers × N pages on Pro every five minutes — the
 * burn that emptied the last plan. DexScreener's per-ticker walk covers the
 * same set without a CoinGecko invoice.
 */
export async function rwaRegistryPools(): Promise<OnchainPool[]> {
  return [];
}

/**
 * Every liquid Uniswap pool CoinGecko indexes on Robinhood, via megafilter.
 *
 * Used to find USDG/WETH community markets that never appear on an RWA ticker's
 * pair page.
 */
export async function megafilterPools(): Promise<OnchainPool[]> {
  if (!AUTHENTICATED) return [];

  const key = "gt:megafilter:robinhood";
  const load = async () => {
    const seen = new Map<string, OnchainPool>();

    for (let page = 1; page <= MEGAFILTER_MAX_PAGES; page++) {
      const params = new URLSearchParams({
        networks: NETWORK,
        reserve_usd_min: String(MIN_POOL_LIQUIDITY_USD),
        sort: "reserve_usd_desc",
        page: String(page),
      });
      const pagePools = await fetchPoolsPage(
        `/pools/megafilter?${params}&include=base_token,quote_token`,
      );
      if (pagePools.length === 0) break;
      for (const pool of pagePools) {
        seen.set(pool.pairAddress, pool);
      }
      if (pagePools.length < POOLS_PAGE_SIZE) break;
    }

    return [...seen.values()];
  };

  try {
    return await cached(key, MEGAFILTER_TTL_MS, load);
  } catch (error) {
    console.error("gecko megafilter failed", error);
  }

  return stale<OnchainPool[]>(key) ?? [];
}

/** How each of the app's timeframes maps onto GeckoTerminal's buckets. */
const BUCKETS: Record<Timeframe, {path: string; aggregate?: number}> = {
  "1m": {path: "minute", aggregate: 1},
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
 * Buckets from coarsest to finest.
 *
 * A pool that opened an hour ago has exactly one hourly candle and no daily
 * one, and a single point is not a chart — it used to send every freshly
 * launched token to the simulated series instead, which is the whole of why
 * new tokens charted a price history that never happened. Stepping down the
 * ladder until a bucket actually has history is what puts a token's first
 * minutes on screen, starting where its pool opened.
 */
const BUCKET_LADDER: Timeframe[] = ["1D", "4h", "1h", "15m", "5m", "1m"];

/** Widest bucket that still has a real shape. Step down only when younger. */
export const ENOUGH_TO_DRAW = 20;

/**
 * Which ladder step actually produced the series. The API still returns the
 * requested `timeframe`; callers must surface this when it differs.
 */
export function pickResolvedCandles(
  requested: Timeframe,
  series: Partial<Record<Timeframe, ChartPoint[]>>,
): {points: ChartPoint[]; resolvedTimeframe: Timeframe} {
  const start = BUCKET_LADDER.indexOf(requested);
  const ladder = start === -1 ? [requested] : BUCKET_LADDER.slice(start);
  let best: ChartPoint[] = [];
  let resolved = requested;
  for (const bucket of ladder) {
    const points = series[bucket] ?? [];
    if (points.length > best.length) {
      best = points;
      resolved = bucket;
    }
    if (best.length >= ENOUGH_TO_DRAW) break;
  }
  return best.length > 1
    ? {points: best, resolvedTimeframe: resolved}
    : {points: [], resolvedTimeframe: requested};
}

/** One bucket's worth of closes, oldest first. Empty when the pool has none. */
async function candlesAt(
  pool: string,
  timeframe: Timeframe,
  token: string | null,
  limit: number,
): Promise<ChartPoint[]> {
  const bucket = BUCKETS[timeframe];
  const key = `gt:ohlcv:${pool}:${timeframe}:${token ?? "base"}`;

  const load = async (): Promise<ChartPoint[]> => {
    const params = new URLSearchParams({limit: String(limit)});
    if (bucket.aggregate) params.set("aggregate", String(bucket.aggregate));
    // Without this the series describes the pool's base token. On a pool that
    // quotes the other way round that is the counterparty — charting a stock
    // worth hundreds of dollars as if it were a token worth a fraction of a
    // cent, which then multiplied out to a market cap in the billions.
    if (token) params.set("token", token);

    const fetched = await get<OhlcvResponse>(
      `/networks/${NETWORK}/pools/${pool}/ohlcv/${bucket.path}?${params}`,
      {caller: "chart", tier: "auto"},
    );
    if (!fetched.data) {
      throw new Error(fetched.error ?? "Could not load candles.");
    }

    const list = fetched.data.data?.attributes?.ohlcv_list ?? [];
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

/**
 * Candles for a pool, oldest first, in the shape `PriceChart` already takes.
 *
 * Only the close is used — the component draws a line, not a candlestick — but
 * the full OHLC is what the endpoint returns and what a candlestick chart would
 * need if one is ever added.
 *
 * A mature pool answers on the first request and costs exactly what it always
 * did; only a pool too young to fill the asked-for bucket walks further down.
 */
export async function candles(
  pool: string,
  timeframe: Timeframe,
  /** The asset whose price this is, so a quote-side pool still reads right. */
  token: string | null = null,
  limit = 120,
): Promise<{
  points: ChartPoint[];
  error: string | null;
  resolvedTimeframe: Timeframe;
}> {
  const start = BUCKET_LADDER.indexOf(timeframe);
  const ladder = start === -1 ? [timeframe] : BUCKET_LADDER.slice(start);

  const series: Partial<Record<Timeframe, ChartPoint[]>> = {};
  let lastError: string | null = null;

  for (const bucket of ladder) {
    try {
      series[bucket] = await candlesAt(pool, bucket, token, limit);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Could not load candles.";
    }
    const soFar = pickResolvedCandles(timeframe, series);
    // Enough to read as a shape rather than a straight segment between two
    // dots. A pool an hour old clears this on minutes where it could not on
    // hours, which is exactly the case this ladder exists for.
    if (soFar.points.length >= ENOUGH_TO_DRAW) {
      return {points: soFar.points, error: null, resolvedTimeframe: soFar.resolvedTimeframe};
    }
  }

  const picked = pickResolvedCandles(timeframe, series);
  // Two points still beats none — it is a real open and a real close — but a
  // lone candle is not a chart and must not be padded into one.
  if (picked.points.length > 1) {
    return {points: picked.points, error: null, resolvedTimeframe: picked.resolvedTimeframe};
  }
  return {points: [], error: lastError, resolvedTimeframe: timeframe};
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
): Promise<{trades: Trade[]; error: string | null}> {
  const wanted = tokenAddress.toLowerCase();
  const key = `gt:trades:${pool}:${wanted}`;

  const load = async (): Promise<Trade[]> => {
    const params = new URLSearchParams({
      token: wanted,
      limit: String(TRADES_PAGE),
    });
    const fetched = await get<TradesResponse>(
      `/networks/${NETWORK}/pools/${pool}/trades?${params}`,
      {caller: "tape", tier: "free"},
    );
    if (!fetched.data) {
      throw new Error(fetched.error ?? "Could not load trades.");
    }

    return (fetched.data.data ?? [])
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
    if (loaded.length > 0) return {trades: loaded.slice(0, limit), error: null};
  } catch (error) {
    const previous = stale<Trade[]>(key);
    if (previous && previous.length > 0) {
      return {trades: previous.slice(0, limit), error: null};
    }
    return {
      trades: [],
      error: error instanceof Error ? error.message : "Could not load trades.",
    };
  }

  const previous = stale<Trade[]>(key);
  if (previous && previous.length > 0) {
    return {trades: previous.slice(0, limit), error: null};
  }
  return {trades: [], error: null};
}

const TOKEN_IMAGE_TTL_MS = 6 * 60 * 60_000;
const TOKEN_IMAGE_BATCH = 30;

interface TokenImageRow {
  attributes?: {address?: string; image_url?: string};
}

function usableTokenImage(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  if (/missing|placeholder|default/i.test(url)) return null;
  return url.trim();
}

/**
 * Deploy-time / metadata art GeckoTerminal indexed for these tokens.
 *
 * DexScreener's pair `info.imageUrl` is the community-updated profile and
 * wins when it exists. This is the fallback for tokens that have not had a
 * profile takeover yet — usually the image uploaded at launch.
 */
export async function tokenImages(
  addresses: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [
    ...new Set(addresses.map((address) => address.toLowerCase())),
  ].filter(Boolean);

  for (let i = 0; i < unique.length; i += TOKEN_IMAGE_BATCH) {
    const batch = unique.slice(i, i + TOKEN_IMAGE_BATCH);
    const key = `gt:img:${batch.join(",")}`;
    try {
      const loaded = await cached(key, TOKEN_IMAGE_TTL_MS, async () => {
        const fetched = await get<{data?: TokenImageRow[]}>(
          `/networks/${NETWORK}/tokens/multi/${batch.join(",")}`,
          {caller: "image", tier: "free"},
        );
        const found: Record<string, string> = {};
        for (const row of fetched.data?.data ?? []) {
          const address = row.attributes?.address?.toLowerCase();
          const image = usableTokenImage(row.attributes?.image_url);
          if (address && image) found[address] = image;
        }
        return found;
      });
      for (const [address, image] of Object.entries(loaded)) {
        out.set(address, image);
      }
    } catch {
      // One batch failing costs those images, not the feed.
    }
  }

  return out;
}

const HOLDER_TTL_MS = 30 * 60_000;

interface TokenInfoRow {
  attributes?: {holders?: {count?: number}};
}

/** Holder count from GeckoTerminal token info — chart page only. */
export async function holderCountFor(address: string): Promise<number> {
  const wanted = address.toLowerCase();
  const key = `gt:holders:${wanted}`;
  try {
    const count = await cached(key, HOLDER_TTL_MS, async () => {
      const fetched = await get<{data?: TokenInfoRow}>(
        `/networks/${NETWORK}/tokens/${wanted}/info`,
        {caller: "other", tier: "free"},
      );
      const n = fetched.data?.data?.attributes?.holders?.count;
      return typeof n === "number" && n >= 0 ? n : 0;
    });
    return count;
  } catch {
    return 0;
  }
}
