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
 * Re-scale a series onto the live token price when the provider returned
 * the counterparty. Shape is preserved; a series we cannot re-scale is
 * dropped rather than shown at the stock's price.
 */
export function reorientPoints(
  points: ChartPoint[],
  liveUsd: number | null,
  liquidityUsd: number,
  label?: string,
): ChartPoint[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1].price;
  const inverted = looksInvertedMemecoin(last, liquidityUsd);
  const diverges =
    liveUsd != null &&
    liveUsd > 0 &&
    (last / liveUsd > 20 || liveUsd / last > 20);

  if (!inverted && !diverges) return points;

  if (liveUsd == null || liveUsd <= 0) {
    console.warn("inverted chart hidden; no live token price", {
      label,
      last,
      liquidityUsd,
    });
    return [];
  }

  const factor = liveUsd / last;
  console.warn("inverted chart reoriented onto token", {
    label,
    last,
    liveUsd,
    factor,
  });
  return points.map((point) => ({...point, price: point.price * factor}));
}
