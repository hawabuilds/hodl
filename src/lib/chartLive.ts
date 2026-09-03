import type {ChartPoint, Trade} from "@/lib/types";

/**
 * Extends indexed candles with live fills so the line moves as the tape does.
 *
 * Candles refresh on a slower cadence; trades poll every couple of seconds.
 * Appending fills at or after the last candle keeps the right edge live without
 * waiting for the indexer to close the current bucket.
 */
export function mergeTradesIntoChart(
  points: ChartPoint[],
  trades: Trade[],
): ChartPoint[] {
  if (trades.length === 0) return points;

  const fills = trades
    .map((trade) => ({
      t: Date.parse(trade.at),
      price: trade.priceUsd,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.price) &&
        point.price > 0,
    )
    .sort((a, b) => a.t - b.t);

  if (fills.length === 0) return points;
  if (points.length === 0) return fills;

  const out = [...points];
  const anchor = out[out.length - 1].t;

  for (const fill of fills) {
    if (fill.t < anchor) continue;

    const last = out[out.length - 1];
    if (fill.t === last.t) {
      out[out.length - 1] = fill;
    } else if (fill.t > last.t) {
      out.push(fill);
    }
  }

  return out;
}

/** Window change from the first visible point to the latest (live) close. */
export function changePctForPoints(points: ChartPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].price;
  const last = points[points.length - 1].price;
  if (first <= 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}
