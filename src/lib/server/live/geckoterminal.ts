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
 * Free and unauthenticated, at roughly 30 calls a minute. Everything here is
 * cached hard and backs off on 429 rather than hammering it.
 */

const BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK = "robinhood";

const CANDLE_TTL_MS = 60_000;
const TRADE_TTL_MS = 20_000;
const POOL_TTL_MS = 30 * 60_000;

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
        headers: {accept: "application/json"},
        cache: "no-store",
      });
      if (res.status === 429) {
        await sleep(1200 * (attempt + 1));
        continue;
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
 * `kind` is already buy or sell from the base token's point of view, which is
 * the same convention the tape uses, so no sign juggling is needed here.
 */
export async function trades(
  pool: string,
  /** The asset whose page this is, so amounts describe the right side. */
  tokenAddress: string,
  limit = 40,
): Promise<Trade[]> {
  const key = `gt:trades:${pool}`;

  const load = async (): Promise<Trade[]> => {
    const body = await get<TradesResponse>(
      `/networks/${NETWORK}/pools/${pool}/trades`,
    );

    const wanted = tokenAddress.toLowerCase();

    return (body?.data ?? [])
      .map((row): Trade | null => {
        const a = row.attributes;
        if (!a?.tx_hash || !a.block_timestamp) return null;

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

        return {
          id: `${a.tx_hash}-${a.block_number ?? 0}`,
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
      .filter((trade): trade is Trade => trade !== null)
      .slice(0, limit);
  };

  try {
    const loaded = await cached(key, TRADE_TTL_MS, load);
    if (loaded.length > 0) return loaded;
  } catch {
    // fall through
  }
  return stale<Trade[]>(key) ?? [];
}
