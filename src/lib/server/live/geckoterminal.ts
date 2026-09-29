import type {ChartPoint, Timeframe, Trade} from "@/lib/types";
import {isPlausiblePrice, mergeChartPoints} from "@/lib/chartLwc";
import {CHART_HISTORY_BARS} from "@/lib/chartPlot";
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
import {
  GECKO_RATE_LIMIT_ERROR,
  geckoFetch,
  isGeckoRateLimited,
} from "./geckoFetch";

/**
 * GeckoTerminal / CoinGecko onchain.
 *
 * Pro is for historical candles only. Discovery, images, holders and the tape
 * use the free GeckoTerminal host. A 194-ticker Pro sweep every five minutes
 * is what drained the last plan; that path is gone.
 *
 * On 429 / 401 / 403 the candle path falls through to the free host in the
 * same request. HTTP 429s go through `geckoFetch`: last-good cache, Retry-After
 * cooldown, one short retry. A long sleep-and-retry used to sit a page at
 * ~30s and still return a silent blank.
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

/**
 * The whole budget for a chart or tape request, both hosts included.
 *
 * Each attempt could run 8s, twice on Pro and twice on the free host: a panel
 * could wait half a minute to learn it had failed. Pro gets one try and half
 * the budget, so the free host always has time to answer after it.
 */
export const GECKO_PANEL_BUDGET_MS = 3_000;
const GECKO_PRO_SHARE_MS = 1_500;
const PANEL_CALLERS: ReadonlySet<GeckoCaller> = new Set(["chart", "tape"]);

async function fetchOnce<T>(
  base: string,
  path: string,
  headers: Record<string, string>,
  host: "pro" | "free",
  limits: {deadline?: number; attempts?: number} = {},
): Promise<{status: number; body: T | null; attempted: boolean}> {
  const fetched = await geckoFetch<T>({base, path, headers, host, ...limits});
  return {status: fetched.status, body: fetched.body, attempted: fetched.attempted};
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
 * One Pro attempt (candles only), then free. Cooldown and last-good live in
 * `geckoFetch` — this layer does not sleep.
 *
 * `tier: "free"` never touches Pro — that is the market sweep / tape / images.
 */
async function get<T>(
  path: string,
  opts: {caller: GeckoCaller; tier?: "auto" | "free"},
): Promise<GeckoGet<T>> {
  const tryPro = opts.tier !== "free" && Boolean(API_KEY);
  // Someone is waiting on a chart or a tape; background sweeps are not.
  const deadline = PANEL_CALLERS.has(opts.caller)
    ? Date.now() + GECKO_PANEL_BUDGET_MS
    : undefined;

  if (tryPro) {
    void refreshKeyUsage();
    const pro = await fetchOnce<T>(
      PRO_GECKO_BASE,
      path,
      authHeaders(),
      "pro",
      deadline == null
        ? {}
        : {deadline: Math.min(deadline, Date.now() + GECKO_PRO_SHARE_MS), attempts: 1},
    );
    if (pro.attempted) {
      recordGeckoCall(opts.caller, "pro");
      console.info("gecko pro", {
        caller: opts.caller,
        status: pro.status,
        ...geckoCreditLogFields(),
      });
    }
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

  const free = await fetchOnce<T>(FREE_GECKO_BASE, path, {}, "free", {deadline});
  if (free.attempted) recordGeckoCall(opts.caller, "free");
  if (free.body) return {data: free.body, error: null, host: "free"};
  const status = free.status;
  const error =
    status === 429
      ? GECKO_RATE_LIMIT_ERROR
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
    if (!body.data && body.error) throw new Error(body.error);
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
  if (!fetched.data && fetched.error) throw new Error(fetched.error);
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
  const wanted = address.toLowerCase();
  const key = `gt:pools-public:${wanted}`;
  try {
    return await cached(
      key,
      POOL_TTL_MS,
      () =>
        fetchPoolsPage(
          `/networks/${NETWORK}/tokens/${wanted}/pools?page=1&include=base_token,quote_token`,
        ),
      {cacheEmpty: false},
    );
  } catch {
    return stale<OnchainPool[]>(key) ?? [];
  }
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
    if (isGeckoRateLimited()) break;
    let pagePools: OnchainPool[];
    try {
      pagePools = await fetchPoolsPage(
        `/networks/${NETWORK}/tokens/${wanted}/pools?page=${page}&include=base_token,quote_token`,
      );
    } catch {
      break;
    }
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
      if (isGeckoRateLimited()) break;
      const params = new URLSearchParams({
        networks: NETWORK,
        reserve_usd_min: String(MIN_POOL_LIQUIDITY_USD),
        sort: "reserve_usd_desc",
        page: String(page),
      });
      let pagePools: OnchainPool[];
      try {
        pagePools = await fetchPoolsPage(
          `/pools/megafilter?${params}&include=base_token,quote_token`,
        );
      } catch {
        break;
      }
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
 * Coarse → fine. Only 1D walks this list. A 5m tab stays 5-minute candles;
 * too young for daily is labeled or empty, never 5m bars on a daily axis.
 */
const BUCKET_LADDER: Timeframe[] = ["1D", "4h", "1h", "15m", "5m", "1m"];

const BUCKET_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

/**
 * The coarsest bucket a token is old enough to have two of.
 *
 * A 1D chart for a token too young for two daily candles used to walk the
 * ladder coarse to fine, one call per rung, until something could draw: up to
 * six calls in a row for a token a few minutes old. Its age says where that
 * walk would have stopped, so the chart can start there.
 */
export function bucketForAge(ageMs: number): Timeframe {
  for (const bucket of BUCKET_LADDER) {
    if (ageMs >= 2 * BUCKET_MS[bucket]) return bucket;
  }
  return "1m";
}

/** Extra Gecko pages on first load so launch prints can sit on the axis. */
const MAX_ORIGIN_PAGES = 5;

/** A line needs two real prints. One candle is not a chart and must not be padded. */
export const ENOUGH_TO_DRAW = 2;

/**
 * Requested resolution only, except 1D may step down and the page labels it.
 * 5m never becomes 1m.
 */
export function candleLadder(requested: Timeframe): Timeframe[] {
  if (requested === "1D") {
    const start = BUCKET_LADDER.indexOf("1D");
    return start === -1 ? [requested] : BUCKET_LADDER.slice(start);
  }
  return [requested];
}

/**
 * Keep the requested bucket when it already has a line. Step down only
 * on 1D when that interval cannot draw, and report the bucket that was used.
 */
export function pickResolvedCandles(
  requested: Timeframe,
  series: Partial<Record<Timeframe, ChartPoint[]>>,
): {points: ChartPoint[]; resolvedTimeframe: Timeframe} {
  for (const bucket of candleLadder(requested)) {
    const points = series[bucket] ?? [];
    if (points.length > 1) {
      return {points, resolvedTimeframe: bucket};
    }
  }
  return {points: [], resolvedTimeframe: requested};
}

/**
 * Gecko OHLCV rows, oldest first. Zero-volume buckets are gaps, not holds.
 */
export function realOhlcvCloses(list: number[][]): ChartPoint[] {
  return list
    // [timestamp, open, high, low, close, volume], newest first.
    .map(([seconds, open, high, low, close, volume]) => ({
      t: seconds * 1000,
      price: close,
      open,
      high,
      low,
      volume,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.price) &&
        point.price > 0 &&
        (point.volume == null || point.volume > 0),
    )
    .map(({t, price, open, high, low}) => {
      const point: ChartPoint = {t, price};
      if (isPlausiblePrice(open, price)) point.open = open;
      if (isPlausiblePrice(high, price)) point.high = high;
      if (isPlausiblePrice(low, price)) point.low = low;
      return point;
    })
    .sort((a, b) => a.t - b.t);
}

/**
 * One bucket's worth of closes, oldest first.
 *
 * Empty only when a host answered and the pool has no candles. When both hosts
 * fail and nothing is cached this throws: it used to return an empty list, so
 * an exhausted plan drew a blank chart with no error for hours.
 */
async function candlesAt(
  pool: string,
  timeframe: Timeframe,
  token: string | null,
  limit: number,
  beforeMs?: number,
): Promise<ChartPoint[]> {
  const bucket = BUCKETS[timeframe];
  const beforeKey =
    beforeMs != null && Number.isFinite(beforeMs) ? String(beforeMs) : "tip";
  const key = `gt:ohlcv:${pool}:${timeframe}:${token ?? "base"}:${limit}:${beforeKey}`;

  const load = async (): Promise<ChartPoint[]> => {
    const params = new URLSearchParams({limit: String(limit)});
    if (bucket.aggregate) params.set("aggregate", String(bucket.aggregate));
    // Prefer the token address. `base`/`quote` follow Gecko's pool
    // orientation, which can be the stock on an inverted pair.
    if (token) params.set("token", token);
    if (beforeMs != null && Number.isFinite(beforeMs) && beforeMs > 0) {
      params.set("before_timestamp", String(Math.floor(beforeMs / 1000)));
    }

    const fetched = await get<OhlcvResponse>(
      `/networks/${NETWORK}/pools/${pool}/ohlcv/${bucket.path}?${params}`,
      {caller: "chart", tier: "auto"},
    );
    if (!fetched.data) {
      throw new Error(fetched.error ?? "Could not load candles.");
    }

    const list = fetched.data.data?.attributes?.ohlcv_list ?? [];
    return realOhlcvCloses(list);
  };

  let failure: unknown = null;
  try {
    const loaded = await cached(key, CANDLE_TTL_MS, load);
    if (loaded.length > 0) return loaded;
  } catch (error) {
    failure = error;
  }
  const previous = stale<ChartPoint[]>(key);
  if (previous && previous.length > 0) return previous;
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  return [];
}

async function candlesBackToOrigin(
  pool: string,
  timeframe: Timeframe,
  token: string | null,
  limit: number,
  beforeMs?: number,
  originMs?: number,
): Promise<ChartPoint[]> {
  let points = await candlesAt(pool, timeframe, token, limit, beforeMs);
  if (
    beforeMs != null ||
    originMs == null ||
    !Number.isFinite(originMs) ||
    points.length < 2
  ) {
    return points;
  }

  let pages = 0;
  while (
    pages < MAX_ORIGIN_PAGES &&
    points.length >= limit &&
    points[0].t > originMs &&
    !isGeckoRateLimited()
  ) {
    pages += 1;
    // Older pages are extra. A failure there keeps what has already loaded.
    let older: ChartPoint[];
    try {
      older = await candlesAt(pool, timeframe, token, limit, points[0].t);
    } catch {
      break;
    }
    if (older.length === 0) break;
    const merged = mergeChartPoints(older, points);
    if (merged.length === points.length) break;
    points = merged;
  }
  return points;
}

/**
 * Candles for a pool, oldest first, in the shape `PriceChart` already takes.
 *
 * Close plus real OHLC when Gecko sent them. Zero-volume buckets stay gaps.
 *
 * The requested bucket when it can already form a line. 1D too young for
 * daily bars steps down and the page labels what is shown. Intraday pills
 * stay on that resolution or come back empty.
 */
export async function candles(
  pool: string,
  timeframe: Timeframe,
  /** The asset whose price this is, so a quote-side pool still reads right. */
  token: string | null = null,
  limit = CHART_HISTORY_BARS,
  beforeMs?: number,
  originMs?: number,
): Promise<{
  points: ChartPoint[];
  error: string | null;
  resolvedTimeframe: Timeframe;
}> {
  let ladder = candleLadder(timeframe);
  if (timeframe === "1D" && originMs != null && Number.isFinite(originMs)) {
    // The bucket its age allows, and one finer for a thin pool that has not
    // traded in enough of them to draw. Two calls at most, not six.
    const start = ladder.indexOf(bucketForAge(Date.now() - originMs));
    ladder = ladder.slice(Math.max(0, start), Math.max(0, start) + 2);
  }
  let lastError: string | null = null;

  for (const bucket of ladder) {
    try {
      const points = await candlesBackToOrigin(
        pool,
        bucket,
        token,
        limit,
        beforeMs,
        originMs,
      );
      if (points.length > 1) {
        return {points, error: null, resolvedTimeframe: bucket};
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "Could not load candles.";
      // A failure is not "this interval is empty". Walking on would only
      // spend another request budget per rung on the same outage.
      break;
    }
    // A 429 is not "this interval is empty" — do not walk 4h/1h/5m/1m next.
    if (isGeckoRateLimited()) {
      lastError ??= GECKO_RATE_LIMIT_ERROR;
      break;
    }
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
        if (!fetched.data && fetched.error) throw new Error(fetched.error);
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
      if (!fetched.data && fetched.error) throw new Error(fetched.error);
      const n = fetched.data?.data?.attributes?.holders?.count;
      return typeof n === "number" && n >= 0 ? n : 0;
    });
    return count;
  } catch {
    return 0;
  }
}
