import {marketSession, needsDailyCloses, stockMove, type RwaSession, type StockMove, type StockQuoteFields} from "@/lib/rwaMove";
import {cached, getJson, stale} from "./cache";
import {RWA_REGISTRY} from "./robinhood";

/**
 * Robinhood's stock market data for every RWA, in batches.
 *
 * The per-ticker token quote (`quotes()` in ./robinhood) is what a trade is
 * priced at. This is the listed stock itself: the real day move, the
 * company's market cap, and the day's intraday line — each one batched call
 * per 50–75 symbols, so the whole list costs a handful of requests.
 */

const BASE = "https://api.robinhood.com";
const QUOTE_BATCH = 50;
const HISTORY_BATCH = 75;

const MOVES_TTL_MS = 60_000;
const DAILY_TTL_MS = 30 * 60_000;
const INTRADAY_TTL_MS = 5 * 60_000;
const FUNDAMENTALS_TTL_MS = 6 * 60 * 60_000;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const TICKERS = () => RWA_REGISTRY.map((entry) => entry.ticker);

const num = (value: unknown): number | null => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) ? n : null;
};

interface MarketQuote {
  symbol?: string;
  last_trade_price?: string | null;
  previous_close?: string | null;
  adjusted_previous_close?: string | null;
  previous_close_date?: string | null;
  venue_last_trade_time?: string | null;
}

async function loadStockQuotes(): Promise<Record<string, StockQuoteFields>> {
  const out: Record<string, StockQuoteFields> = {};
  for (const batch of chunks(TICKERS(), QUOTE_BATCH)) {
    const body = await getJson<{results?: (MarketQuote | null)[]}>(
      `${BASE}/marketdata/quotes/?symbols=${batch.map(encodeURIComponent).join(",")}`,
      9000,
    );
    (body.results ?? []).forEach((quote, index) => {
      if (!quote) return;
      out[batch[index]] = {
        last: num(quote.last_trade_price),
        // Adjusted for splits and dividends, so a split day is not a crash.
        previousClose: num(quote.adjusted_previous_close) ?? num(quote.previous_close),
        previousCloseDate: quote.previous_close_date ?? null,
        lastTradeAt: quote.venue_last_trade_time ?? null,
      };
    });
  }
  return out;
}

interface HistoricalsBatch {
  results?: ({symbol?: string; historicals?: {begins_at: string; close_price: string}[]} | null)[];
}

async function loadHistoricals(
  tickers: string[],
  params: Record<string, string>,
): Promise<Record<string, {at: string; close: number}[]>> {
  const out: Record<string, {at: string; close: number}[]> = {};
  const query = new URLSearchParams(params).toString();
  for (const batch of chunks(tickers, HISTORY_BATCH)) {
    const body = await getJson<HistoricalsBatch>(
      `${BASE}/marketdata/historicals/?symbols=${batch.map(encodeURIComponent).join(",")}&${query}`,
      12_000,
    );
    for (const row of body.results ?? []) {
      if (!row?.symbol) continue;
      out[row.symbol.toUpperCase()] = (row.historicals ?? [])
        .map((bar) => ({at: bar.begins_at, close: Number(bar.close_price)}))
        .filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
    }
  }
  return out;
}

/** Last completed daily closes, for the before-the-open case in `stockMove`. */
async function dailyCloses(tickers: string[]): Promise<Record<string, number[]>> {
  if (tickers.length === 0) return {};
  const key = "rh:daily-closes";
  try {
    const all = await cached(key, DAILY_TTL_MS, async () => {
      const bars = await loadHistoricals(TICKERS(), {interval: "day", span: "week", bounds: "regular"});
      return Object.fromEntries(Object.entries(bars).map(([ticker, list]) => [ticker, list.map((bar) => bar.close)]));
    });
    return all;
  } catch {
    return stale<Record<string, number[]>>(key) ?? {};
  }
}

export interface StockMoves {
  session: RwaSession;
  moves: Record<string, StockMove>;
}

/**
 * Every RWA's real move, and whether that is today's or the last session's.
 * One figure per stock, used everywhere on the RWAs page.
 */
export async function stockMoves(now = new Date()): Promise<StockMoves> {
  const key = "rh:stock-moves:v1";
  const load = async (): Promise<StockMoves> => {
    const quotes = await loadStockQuotes();
    const newest = Object.values(quotes)
      .map((quote) => quote.lastTradeAt)
      .filter((at): at is string => Boolean(at))
      .sort()
      .at(-1) ?? null;
    const needDaily = Object.keys(quotes).filter((ticker) => needsDailyCloses(quotes[ticker]));
    const daily = await dailyCloses(needDaily);
    const moves: Record<string, StockMove> = {};
    for (const ticker of TICKERS()) {
      const move = stockMove(quotes[ticker], daily[ticker]);
      if (move) moves[ticker] = move;
    }
    return {session: marketSession(now, newest), moves};
  };
  try {
    return await cached(key, MOVES_TTL_MS, load);
  } catch {
    return stale<StockMoves>(key) ?? {session: marketSession(now, null), moves: {}};
  }
}

/**
 * The day's intraday line per stock — the last session's when the market is
 * shut — sampled every 10 minutes. Used for the list's sparklines.
 */
export async function intradayLines(): Promise<Record<string, number[]>> {
  const key = "rh:intraday-lines:v1";
  try {
    return await cached(key, INTRADAY_TTL_MS, async () => {
      const bars = await loadHistoricals(TICKERS(), {interval: "10minute", span: "day", bounds: "regular"});
      return Object.fromEntries(Object.entries(bars).map(([ticker, list]) => [ticker, list.map((bar) => bar.close)]));
    });
  } catch {
    return stale<Record<string, number[]>>(key) ?? {};
  }
}

/** Evenly thinned, so a full session's 10-minute bars draw as a light line. */
export function thinSeries(series: number[], points = 40): number[] {
  if (series.length <= points) return series;
  const step = (series.length - 1) / (points - 1);
  return Array.from({length: points}, (_, i) => series[Math.round(i * step)]);
}

/** Each company's market cap, in dollars. Changes slowly; refreshed every six hours. */
export async function companyMarketCaps(): Promise<Record<string, number>> {
  const key = "rh:market-caps:v1";
  try {
    return await cached(key, FUNDAMENTALS_TTL_MS, async () => {
      const out: Record<string, number> = {};
      for (const batch of chunks(TICKERS(), QUOTE_BATCH)) {
        const body = await getJson<{results?: ({market_cap?: string | null} | null)[]}>(
          `${BASE}/fundamentals/?symbols=${batch.map(encodeURIComponent).join(",")}`,
          12_000,
        );
        (body.results ?? []).forEach((row, index) => {
          const cap = num(row?.market_cap);
          if (cap != null && cap > 0) out[batch[index]] = cap;
        });
      }
      return out;
    });
  } catch {
    return stale<Record<string, number>>(key) ?? {};
  }
}
