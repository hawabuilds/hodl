import {normalizeAddress, sameAddress} from "@/lib/address";
import type {ChartPoint} from "@/lib/types";

/**
 * Which side of a pool is the HODL token, and what that means for `priceUsd`.
 *
 * DexScreener / Gecko `priceUsd` always describes the *base*. When the
 * memecoin is the quote (SPACEHOOD / SPCX), that number is the stock.
 */

export interface OrientedPair {
  base?: string | null;
  quote?: string | null;
  priceUsd?: string | number | null;
  priceNative?: string | number | null;
  /** Quote token's own USD price, when the provider gives both sides. */
  quotePriceUsd?: string | number | null;
}

export function tokenIsBase(pair: OrientedPair, token: string): boolean {
  return pair.base != null && sameAddress(pair.base, token);
}

export function tokenIsQuote(pair: OrientedPair, token: string): boolean {
  return pair.quote != null && sameAddress(pair.quote, token);
}

/**
 * USD price of `token` in this pool. Null when the pair does not contain
 * the token, or when it is the quote side and we have no ratio.
 */
export function usdPriceFor(pair: OrientedPair, token: string): number | null {
  const address = normalizeAddress(token);
  const base = pair.base ? normalizeAddress(pair.base) : "";
  const quote = pair.quote ? normalizeAddress(pair.quote) : "";
  const baseUsd = Number(pair.priceUsd ?? 0);
  if (!Number.isFinite(baseUsd) || baseUsd <= 0) return null;
  if (base === address) return baseUsd;
  if (quote === address) {
    const quoteUsd = Number(pair.quotePriceUsd ?? 0);
    if (Number.isFinite(quoteUsd) && quoteUsd > 0) return quoteUsd;
    const native = Number(pair.priceNative ?? 0);
    if (Number.isFinite(native) && native > 0) return baseUsd / native;
    return null;
  }
  return null;
}

/** A memecoin printed at equity scale is the other side of the pair. */
export function looksInvertedMemecoin(
  price: number,
  liquidityUsd: number,
): boolean {
  return price > 10 && liquidityUsd > 0 && liquidityUsd < 1_000_000;
}

/**
 * How far the chart's last close may sit from the pool's latest on-chain
 * trade and still be the same series. Loose on purpose: the last candle can be
 * a few minutes older than the trade, and a memecoin moves. A series quoted the
 * wrong way round is off by orders of magnitude, not by 10x.
 */
export const ORIENTATION_TOLERANCE = 10;

/**
 * How close 1/close must be to the trade to flip. Tight, because a loose flip
 * can be a coincidence: a stock at $149 is 1/0.0067, within 10x of a token at
 * $0.0097, and flipping that would draw the stock upside down as the token.
 * A series really quoted the other way round matches the trade almost exactly.
 */
export const FLIP_TOLERANCE = 1.25;

export type Orientation = "kept" | "flipped" | "hidden";

function within(a: number, b: number, ratio: number): boolean {
  return a > 0 && b > 0 && a / b <= ratio && b / a <= ratio;
}

/** A candle quoted the other way round: every level is 1/x, so high and low swap. */
function flipPoint(point: ChartPoint): ChartPoint {
  const next: ChartPoint = {t: point.t, price: 1 / point.price};
  if (point.open != null && point.open > 0) next.open = 1 / point.open;
  if (point.low != null && point.low > 0) next.high = 1 / point.low;
  if (point.high != null && point.high > 0) next.low = 1 / point.high;
  return next;
}

/**
 * Checks a pool's candles against its latest on-chain trade and turns them the
 * right way round if they came back quoted in the other token.
 *
 * The chain is the reference, never a provider's price: rescaling a series to
 * a provider price once let a stored price weeks old multiply a whole chart by
 * 22, drawing a crash that never happened. Candles are only ever kept, flipped
 * (1/price), or hidden — never stretched to fit a number from somewhere else.
 *
 * - Last close near the trade: kept.
 * - 1/close within 25% of the trade: flipped.
 * - Neither: hidden. The series is not this token's price, and no factor is
 *   invented to make it look like one.
 * - No trade to check against: kept, unless it is a memecoin printed at equity
 *   scale — the stock's side of the pool — which is hidden.
 */
export function decideOrientation(
  points: ChartPoint[],
  tradePriceUsd: number | null | undefined,
  liquidityUsd: number,
  label?: string,
): Orientation {
  if (points.length === 0) return "kept";
  const last = points[points.length - 1].price;
  const trade =
    typeof tradePriceUsd === "number" && Number.isFinite(tradePriceUsd) && tradePriceUsd > 0
      ? tradePriceUsd
      : null;

  if (trade == null) {
    if (!looksInvertedMemecoin(last, liquidityUsd)) return "kept";
    console.warn("chart hidden: counterparty scale and no trade to check", {label, last, liquidityUsd});
    return "hidden";
  }

  if (within(last, trade, ORIENTATION_TOLERANCE)) return "kept";
  if (last > 0 && within(1 / last, trade, FLIP_TOLERANCE)) {
    console.warn("chart flipped to match the pool's latest trade", {label, last, trade});
    return "flipped";
  }
  console.warn("chart hidden: candles disagree with the pool's latest trade", {label, last, trade});
  return "hidden";
}

/**
 * The same decision for every page of one pool's history. Older pages are not
 * checked on their own: a token up 100,000x since launch has early candles far
 * from today's trade, and that is its history, not the wrong way round.
 */
export function applyOrientation(points: ChartPoint[], orientation: Orientation): ChartPoint[] {
  if (orientation === "hidden") return [];
  if (orientation === "flipped") return points.filter((point) => point.price > 0).map(flipPoint);
  return points;
}

export function orientAgainstTrade(
  points: ChartPoint[],
  tradePriceUsd: number | null | undefined,
  liquidityUsd: number,
  label?: string,
): {points: ChartPoint[]; orientation: Orientation} {
  const orientation = decideOrientation(points, tradePriceUsd, liquidityUsd, label);
  return {points: applyOrientation(points, orientation), orientation};
}
