import type {ChartPoint, Trade} from "@/lib/types";
import {isPlausiblePrice} from "@/lib/chartLwc";

/** Dust USD — wei / wrong-decimal indexer prints, not a real fill. */
const MIN_FILL_USD = 1e-6;

export function bucketStart(t: number, bucketMs: number): number {
  if (!(bucketMs > 0) || !Number.isFinite(t)) return t;
  return Math.floor(t / bucketMs) * bucketMs;
}

function applyFill(candle: ChartPoint, price: number): ChartPoint {
  const high =
    candle.high != null ? Math.max(candle.high, price) : Math.max(candle.price, price);
  const low =
    candle.low != null ? Math.min(candle.low, price) : Math.min(candle.price, price);
  return {...candle, price, high, low};
}

export function alignPointsToBucket(
  points: ChartPoint[],
  bucketMs: number,
): ChartPoint[] {
  if (points.length === 0 || !(bucketMs > 0)) return points;
  const out: ChartPoint[] = [];
  for (const point of points) {
    const t = bucketStart(point.t, bucketMs);
    const last = out[out.length - 1];
    if (last && last.t === t) {
      out[out.length - 1] = applyFill(last, point.price);
      continue;
    }
    out.push({...point, t});
  }
  return out;
}

function bucketFills(
  fills: Array<{t: number; price: number}>,
  bucketMs: number,
): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const fill of fills) {
    const t = bucketStart(fill.t, bucketMs);
    const last = out[out.length - 1];
    if (last && last.t === t) {
      out[out.length - 1] = applyFill(last, fill.price);
      continue;
    }
    out.push({
      t,
      price: fill.price,
      open: last?.price ?? fill.price,
      high: last != null ? Math.max(last.price, fill.price) : fill.price,
      low: last != null ? Math.min(last.price, fill.price) : fill.price,
    });
  }
  return out;
}

/**
 * Extends indexed candles with live fills so the line moves as the tape does.
 *
 * Candles refresh on a slower cadence; trades poll every couple of seconds.
 * Folds fills into the requested bucket so a 5m tab stays 5-minute candles
 * instead of growing a tick ladder after the last indexed bar.
 */
export function mergeTradesIntoChart(
  points: ChartPoint[],
  trades: Trade[],
  bucketMs?: number,
): ChartPoint[] {
  if (trades.length === 0) return points;

  const fills = trades
    .map((trade) => ({
      t: Date.parse(trade.at),
      price: trade.priceUsd,
      amountUsd: trade.amountUsd,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        isPlausiblePrice(point.price) &&
        Number.isFinite(point.amountUsd) &&
        point.amountUsd > MIN_FILL_USD,
    )
    .sort((a, b) => a.t - b.t);

  if (fills.length === 0) {
    return bucketMs != null && bucketMs > 0
      ? alignPointsToBucket(points, bucketMs)
      : points;
  }
  if (points.length === 0) {
    return bucketMs != null && bucketMs > 0
      ? bucketFills(fills, bucketMs)
      : fills;
  }

  const aligned =
    bucketMs != null && bucketMs > 0
      ? alignPointsToBucket(points, bucketMs)
      : points;
  const out = [...aligned];
  const useBuckets = bucketMs != null && bucketMs > 0;
  const anchor = useBuckets
    ? bucketStart(out[out.length - 1].t, bucketMs)
    : out[out.length - 1].t;

  for (const fill of fills) {
    if (useBuckets) {
      const t = bucketStart(fill.t, bucketMs);
      if (t < anchor) continue;
      const last = out[out.length - 1];
      if (!isPlausiblePrice(fill.price, last.price)) continue;
      const lastBucket = bucketStart(last.t, bucketMs);
      if (t === lastBucket) {
        out[out.length - 1] = applyFill(last, fill.price);
      } else {
        out.push({
          t,
          price: fill.price,
          open: last.price,
          high: Math.max(last.price, fill.price),
          low: Math.min(last.price, fill.price),
        });
      }
      continue;
    }

    if (fill.t < anchor) continue;
    const last = out[out.length - 1];
    if (!isPlausiblePrice(fill.price, last.price)) continue;
    if (fill.t === last.t) {
      out[out.length - 1] = applyFill(last, fill.price);
    } else if (fill.t > last.t) {
      out.push({
        t: fill.t,
        price: fill.price,
        open: last.price,
        high: Math.max(last.price, fill.price),
        low: Math.min(last.price, fill.price),
      });
    }
  }

  return out;
}

/**
 * Window change from the first visible close to the latest (live) close.
 * Hovered-bar % is `hoveredCandleChangePct` — this is the unscrubbed header only.
 */
export function changePctForPoints(points: ChartPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].price;
  const last = points[points.length - 1].price;
  if (first <= 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}
