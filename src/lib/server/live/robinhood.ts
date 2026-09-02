import registry from "../rwaRegistry.json";
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
