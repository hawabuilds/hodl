import type {ChartPoint, Timeframe} from "@/lib/types";
import registry from "../rwaRegistry.json" with {type: "json"};
import {cached, getJson, stale} from "./cache";

/**
 * Robinhood's own asset and quote APIs.
 *
 * Public, unauthenticated, 60 requests a second across all endpoints. This is
 * the authority on what a stock token is and what it is worth — the pools are
 * far too thin to price these assets, so nothing here is derived from a DEX.
 *
 * TODO(live): the registry is a JSON snapshot in the repo rather than a call to
 * `/rhj/assets`, so a new listing needs a rebuild. Part 04 step 1 has the weekly
 * refresh job that removes that.
 */

const QUOTE_TTL_MS = 30_000;

/**
 * Symbols in flight at once.
 *
 * The documented ceiling is 60 requests a second, but bursting 194 of them at
 * twelve-wide drew 429s on a handful every pass — which quietly dropped those
 * assets out of the feed. Six, with a backoff on 429, gets all 194 through.
 */
const CONCURRENCY = 6;

/** Attempts per symbol before giving up, with a pause between each. */
const RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RegistryEntry {
  ticker: string;
  name: string;
  address: string;
  decimals: number;
  multiplier: string;
  logoUrl: string | null;
  isin: string | null;
  sector: string | null;
  stockType: string | null;
  description: string | null;
}

export const RWA_REGISTRY = registry as RegistryEntry[];

export const RWA_BY_TICKER = new Map(
  RWA_REGISTRY.map((entry) => [entry.ticker, entry]),
);

export const RWA_BY_ADDRESS = new Map(
  RWA_REGISTRY.map((entry) => [entry.address.toLowerCase(), entry]),
);

interface QuoteResponse {
  quotes?: {
    tokenSymbol: string;
    bid: string;
    ask: string;
    dailyTradingVolume?: string;
    dailyHigh?: string;
    dailyLow?: string;
    isTradingHalt?: boolean;
    generatedAt?: string;
  }[];
}

export interface Quote {
  ticker: string;
  priceUsd: number;
  bid: number;
  ask: number;
  volume24hUsd: number;
  dailyHigh: number | null;
  dailyLow: number | null;
  halted: boolean;
}

function parseQuote(ticker: string, body: QuoteResponse): Quote | null {
  const q = body.quotes?.[0];
  if (!q) return null;

  const bid = Number(q.bid);
  const ask = Number(q.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0) return null;

  return {
    ticker,
    // The mid. A bid or an ask on its own is a side of the market, not a price.
    priceUsd: (bid + ask) / 2,
    bid,
    ask,
    volume24hUsd: Number(q.dailyTradingVolume ?? 0) || 0,
    dailyHigh: Number(q.dailyHigh) || null,
    dailyLow: Number(q.dailyLow) || null,
    halted: Boolean(q.isTradingHalt),
  };
}

async function loadQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  let index = 0;

  async function worker() {
    while (index < tickers.length) {
      const ticker = tickers[index++];

      for (let attempt = 0; attempt < RETRIES; attempt++) {
        try {
          const body = await getJson<QuoteResponse>(
            `https://api.robinhood.com/rhj/prices/${encodeURIComponent(ticker)}`,
            9000,
          );
          const quote = parseQuote(ticker, body);
          if (quote) out.set(ticker, quote);
          break;
        } catch (error) {
          const rateLimited = String(error).includes("429");
          // Only a 429 is worth waiting on. Anything else will fail again.
          if (!rateLimited || attempt === RETRIES - 1) break;
          await sleep(250 * (attempt + 1));
        }
      }
    }
  }

  await Promise.all(
    Array.from({length: Math.min(CONCURRENCY, tickers.length)}, worker),
  );
  return out;
}

/**
 * Live quotes for the whole universe.
 *
 * Each refresh is merged over the previous one rather than replacing it. Two
 * hundred symbols against a rate-limited API means a handful time out on any
 * given pass, and replacing wholesale made assets blink out of the feed — the
 * count swung between 194 and 141 between refreshes. A quote that failed this
 * minute is still a better answer than no row at all, and it carries its own
 * timestamp for anything that needs to judge freshness.
 */
export async function quotes(): Promise<Map<string, Quote>> {
  const key = "rh:quotes";
  const previous = stale<Map<string, Quote>>(key) ?? new Map<string, Quote>();

  try {
    const loaded = await cached(key, QUOTE_TTL_MS, async () => {
      const fresh = await loadQuotes(RWA_REGISTRY.map((entry) => entry.ticker));
      // Anything that answered this pass wins; anything that did not keeps the
      // last price we actually saw.
      const merged = new Map(previous);
      for (const [ticker, quote] of fresh) merged.set(ticker, quote);
      return merged;
    });
    if (loaded.size > 0) return loaded;
  } catch {
    // fall through
  }
  return previous;
}

/** A single quote, for a chart page. Shares the same cached batch. */
export async function quoteFor(ticker: string): Promise<Quote | null> {
  const all = await quotes();
  return all.get(ticker.toUpperCase()) ?? null;
}

/**
 * Quotes already in memory, without triggering a fetch.
 *
 * For callers that want prices if they are to hand but must not pay two hundred
 * requests to get them — the reward scan being the one that taught us that.
 */
export function cachedQuotes(): Map<string, Quote> {
  return stale<Map<string, Quote>>("rh:quotes") ?? new Map();
}

/**
 * Official equity history for a stock token chart.
 *
 * Robinhood's quote is the price of these assets. DEX candles are not — a
 * thin pool on this chain charts a different instrument, which is what broke
 * the axis after the token-chart ladder landed on Gecko only.
 */

export interface HistoricalBar {
  begins_at: string;
  close_price: string;
  interpolated?: boolean;
}

interface HistoricalsResponse {
  historicals?: HistoricalBar[];
}

interface RhBucket {
  interval: string;
  span: string;
  bounds: string;
}

/** Widest bucket first. Step down only when that bucket has no real shape. */
const RH_LADDER: Record<Timeframe, RhBucket[]> = {
  "1D": [
    {interval: "day", span: "year", bounds: "regular"},
    {interval: "hour", span: "month", bounds: "regular"},
    {interval: "10minute", span: "week", bounds: "regular"},
    {interval: "5minute", span: "week", bounds: "extended"},
  ],
  "4h": [
    {interval: "hour", span: "month", bounds: "regular"},
    {interval: "hour", span: "week", bounds: "regular"},
    {interval: "10minute", span: "week", bounds: "regular"},
    {interval: "5minute", span: "week", bounds: "extended"},
  ],
  "1h": [
    {interval: "hour", span: "month", bounds: "regular"},
    {interval: "hour", span: "week", bounds: "regular"},
    {interval: "10minute", span: "week", bounds: "regular"},
    {interval: "5minute", span: "week", bounds: "extended"},
  ],
  "15m": [
    {interval: "10minute", span: "week", bounds: "regular"},
    {interval: "5minute", span: "week", bounds: "extended"},
  ],
  "5m": [
    {interval: "5minute", span: "week", bounds: "extended"},
    {interval: "5minute", span: "day", bounds: "extended"},
  ],
  "1m": [
    {interval: "5minute", span: "week", bounds: "extended"},
    {interval: "5minute", span: "day", bounds: "extended"},
  ],
};

/** A line needs two real closes. Do not step down to pad a thin daily series. */
export const RH_ENOUGH_TO_DRAW = 2;

/** Map a Robinhood interval onto the app's timeframe pills. */
export function rhIntervalToTimeframe(interval: string): Timeframe {
  if (interval === "day") return "1D";
  if (interval === "hour") return "1h";
  if (interval === "10minute") return "15m";
  if (interval === "5minute") return "5m";
  return "1h";
}

const HISTORICAL_TTL_MS = 60_000;

/**
 * Real closes only. Interpolated weekend/gap bars are dropped, never drawn.
 */
export function realHistoricalPoints(bars: HistoricalBar[]): ChartPoint[] {
  return bars
    .filter((bar) => bar.interpolated !== true)
    .map((bar) => ({
      t: Date.parse(bar.begins_at),
      price: Number(bar.close_price),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.price) &&
        point.price > 0,
    )
    .sort((a, b) => a.t - b.t);
}

/**
 * The first bucket that can already form a line. A thin daily series stays
 * daily — two real closes on a long axis — instead of being replaced by
 * hourly prints that fill the window.
 */
export function pickEnoughHistory(
  ladder: ChartPoint[][],
  enough = RH_ENOUGH_TO_DRAW,
  limit = 120,
): ChartPoint[] {
  return pickEnoughHistoryResolved(
    ladder.map((points) => ({points, timeframe: "1D" as Timeframe})),
    enough,
    limit,
  ).points;
}

export function pickEnoughHistoryResolved(
  ladder: {points: ChartPoint[]; timeframe: Timeframe}[],
  enough = RH_ENOUGH_TO_DRAW,
  limit = 120,
): {points: ChartPoint[]; resolvedTimeframe: Timeframe | null} {
  const step = ladder[0];
  if (!step) return {points: [], resolvedTimeframe: null};
  const sliced =
    step.points.length > limit ? step.points.slice(-limit) : step.points;
  return sliced.length >= enough && sliced.length > 1
    ? {points: sliced, resolvedTimeframe: step.timeframe}
    : {points: [], resolvedTimeframe: null};
}

async function historicalsAt(
  ticker: string,
  bucket: RhBucket,
): Promise<ChartPoint[]> {
  const symbol = ticker.toUpperCase();
  const key = `rh:ohlcv:${symbol}:${bucket.interval}:${bucket.span}:${bucket.bounds}`;

  const load = async (): Promise<ChartPoint[]> => {
    const params = new URLSearchParams({
      interval: bucket.interval,
      span: bucket.span,
      bounds: bucket.bounds,
    });
    const body = await getJson<HistoricalsResponse>(
      `https://api.robinhood.com/quotes/historicals/${encodeURIComponent(symbol)}/?${params}`,
      9000,
    );
    return realHistoricalPoints(body.historicals ?? []);
  };

  try {
    const loaded = await cached(key, HISTORICAL_TTL_MS, load);
    if (loaded.length > 0) return loaded;
  } catch {
    // fall through
  }
  return stale<ChartPoint[]>(key) ?? [];
}

/**
 * Candles for a stock token, oldest first, from Robinhood's own tape.
 *
 * Never synthesizes a bar, never fills a gap, never reads a DEX pool.
 */
export async function historicalCandles(
  ticker: string,
  timeframe: Timeframe,
  limit = 120,
): Promise<{points: ChartPoint[]; resolvedTimeframe: Timeframe}> {
  const ladder = RH_LADDER[timeframe] ?? RH_LADDER["1h"];
  const first = ladder[0];
  if (!first) {
    return {points: [], resolvedTimeframe: timeframe};
  }
  const points = await historicalsAt(ticker, first);
  const sliced = points.length > limit ? points.slice(-limit) : points;
  return {
    points: sliced.length > 1 ? sliced : [],
    resolvedTimeframe: rhIntervalToTimeframe(first.interval),
  };
}
