import type {ChartPoint} from "@/lib/types";
import {PLOT_GAP_COMPRESS_BARS, PLOT_RIGHT_PAD} from "@/lib/chartPlot";

/**
 * TradingView Lightweight Charts data helpers.
 *
 * LWC spaces each bar equally, so a weekend or a closed session takes no
 * extra x-width unless we insert whitespace. We never invent a price: a
 * hole stays a hole, optionally compressed to a few empty slots so the
 * line disconnects without a mostly-blank chart.
 */

export function toUtcSeconds(tMs: number): number {
  return Math.floor(tMs / 1000);
}

export interface LwcLinePoint {
  time: number;
  value: number;
}

export interface LwcCandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LwcWhitespace {
  time: number;
}

export type LwcLineItem = LwcLinePoint | LwcWhitespace;
export type LwcCandleItem = LwcCandlePoint | LwcWhitespace;

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * A live tick or OHLC level that is non-positive, or ~100× away from the
 * current close, is a bad print (wei / wrong-decimal / inverted side) — not
 * a real wick. Do not invent a replacement; drop it.
 */
export const PRICE_OUTLIER_RATIO = 100;

export function isPlausiblePrice(
  price: number,
  reference?: number | null,
): boolean {
  if (!isFinitePositive(price)) return false;
  if (reference == null || !isFinitePositive(reference)) return true;
  const ratio = price / reference;
  return (
    ratio <= PRICE_OUTLIER_RATIO && ratio >= 1 / PRICE_OUTLIER_RATIO
  );
}

function usableLevel(n: unknown, close: number): number | null {
  return typeof n === "number" && isPlausiblePrice(n, close) ? n : null;
}

export function candleFromPoint(
  point: ChartPoint,
  prevClose?: number,
): LwcCandlePoint {
  const close = point.price;
  const openRaw = usableLevel(point.open, close);
  const open =
    openRaw ??
    (prevClose != null && prevClose > 0 ? prevClose : close);
  const highRaw = usableLevel(point.high, close);
  const lowRaw = usableLevel(point.low, close);
  const high = highRaw != null ? Math.max(highRaw, open, close) : Math.max(open, close);
  const low = lowRaw != null ? Math.min(lowRaw, open, close) : Math.min(open, close);
  return {
    time: toUtcSeconds(point.t),
    open,
    high,
    low,
    close,
  };
}

export function toLineData(points: ChartPoint[]): LwcLinePoint[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.price) &&
        point.price > 0,
    )
    .map((point) => ({time: toUtcSeconds(point.t), value: point.price}));
}

export function toCandleData(points: ChartPoint[]): LwcCandlePoint[] {
  const out: LwcCandlePoint[] = [];
  let prev: number | undefined;
  for (const point of points) {
    if (
      !Number.isFinite(point.t) ||
      !Number.isFinite(point.price) ||
      point.price <= 0
    ) {
      continue;
    }
    const candle = candleFromPoint(point, prev);
    out.push(candle);
    prev = candle.close;
  }
  return out;
}

/**
 * Percentage this bar printed: (close − open) / open.
 * Uses the same open as the drawn candle (real open, else prior close).
 * This is not the move from the first visible print.
 */
export function candleChangePct(
  bar: ChartPoint,
  prevClose?: number,
): number | null {
  const {open, close} = candleFromPoint(bar, prevClose);
  if (!(open > 0) || !Number.isFinite(close)) return null;
  return Number((((close - open) / open) * 100).toFixed(2));
}

/** Hovered bar's own change, matching the candle under the crosshair. */
export function hoveredCandleChangePct(
  points: ChartPoint[],
  hovered: ChartPoint,
): number | null {
  const idx = points.findIndex((point) => point.t === hovered.t);
  const prevClose = idx > 0 ? points[idx - 1].price : undefined;
  return candleChangePct(hovered, prevClose);
}

export function isLwcWhitespace(
  item: {time: number; value?: number; close?: number},
): boolean {
  return !("value" in item) && !("close" in item);
}

/**
 * Insert at most `maxWhitespace` empty slots across a silent stretch so the
 * line breaks without stretching the hole to calendar width. Times are 1s
 * after the previous real print — unique, ascending, and not a price.
 */
export function withCompressedSessionBreaks<T extends {time: number}>(
  bars: T[],
  realTimesMs: number[],
  gapMs: number | undefined,
  maxWhitespace = PLOT_GAP_COMPRESS_BARS,
): Array<T | LwcWhitespace> {
  if (bars.length === 0) return [];
  if (
    gapMs == null ||
    !Number.isFinite(gapMs) ||
    gapMs === Number.POSITIVE_INFINITY ||
    gapMs <= 0 ||
    maxWhitespace <= 0
  ) {
    return bars;
  }

  const out: Array<T | LwcWhitespace> = [bars[0]];
  for (let i = 1; i < bars.length; i++) {
    const dt = realTimesMs[i] - realTimesMs[i - 1];
    if (dt > gapMs) {
      const after = bars[i - 1].time;
      const before = bars[i].time;
      const room = Math.max(0, before - after - 1);
      const n = Math.min(maxWhitespace, room);
      for (let k = 1; k <= n; k++) {
        out.push({time: after + k});
      }
    }
    out.push(bars[i]);
  }
  return out;
}

/**
 * On-chart TradingView watermark. Apache-2.0 does not require it; hide it
 * and keep a Lightweight Charts link in settings instead.
 */
export const LWC_ATTRIBUTION_LOGO = false;

/** Small empty strip after the last real bar. Never a pad-to-now. */
export const LWC_RIGHT_OFFSET_BARS = 3;

/** Pixel inset after the last bar. Wins over a growing bar-count offset. */
export const LWC_RIGHT_OFFSET_PIXELS = 24;

const LWC_RIGHT_OFFSET_MAX_BARS = 8;

/** Right-hand empty bars after the last real print. Not an extension to now. */
export function rightPadBars(
  pointCount: number,
  pad = PLOT_RIGHT_PAD,
): number {
  if (pointCount < 2) return LWC_RIGHT_OFFSET_BARS;
  return Math.min(
    LWC_RIGHT_OFFSET_MAX_BARS,
    Math.max(LWC_RIGHT_OFFSET_BARS, Math.round(pointCount * pad)),
  );
}

export function lwcLayoutOptions(): {attributionLogo: boolean} {
  return {attributionLogo: LWC_ATTRIBUTION_LOGO};
}

export function lwcTimeScaleOptions(opts?: {
  intraday?: boolean;
  barCount?: number;
}): {
  rightOffset: number;
  rightOffsetPixels: number;
  fixLeftEdge: boolean;
  fixRightEdge: boolean;
  lockVisibleTimeRangeOnResize: boolean;
  barSpacing: number;
  minBarSpacing: number;
} {
  const spacing = lwcBarSpacing(opts?.barCount ?? 0, opts?.intraday === true);
  return {
    rightOffset: LWC_RIGHT_OFFSET_BARS,
    rightOffsetPixels: LWC_RIGHT_OFFSET_PIXELS,
    fixLeftEdge: true,
    // Unlocked so a left pan can sit on older real candles. Locking this
    // pins the newest bar to the right edge and snaps every live tick back.
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: false,
    barSpacing: spacing.barSpacing,
    minBarSpacing: spacing.minBarSpacing,
  };
}

/** Filled bodies, matching wicks/borders. LWC candles have no `thinBars`. */
export function lwcCandleStyleOptions(colors: {
  green: string;
  red: string;
}): {
  upColor: string;
  downColor: string;
  borderVisible: boolean;
  borderUpColor: string;
  borderDownColor: string;
  wickUpColor: string;
  wickDownColor: string;
  priceLineVisible: boolean;
  lastValueVisible: boolean;
} {
  return {
    upColor: colors.green,
    downColor: colors.red,
    borderVisible: true,
    borderUpColor: colors.green,
    borderDownColor: colors.red,
    wickUpColor: colors.green,
    wickDownColor: colors.red,
    priceLineVisible: false,
    lastValueVisible: false,
  };
}

/**
 * Keep 1m/5m bodies readable on a short tape. Fit-content still sizes the
 * window to real prints; minBarSpacing stops zoom-out hairlines.
 */
export function lwcBarSpacing(
  barCount: number,
  intraday: boolean,
): {barSpacing: number; minBarSpacing: number} {
  if (!intraday) return {barSpacing: 6, minBarSpacing: 0.5};
  if (barCount > 0 && barCount < 30) return {barSpacing: 14, minBarSpacing: 6};
  if (barCount < 80) return {barSpacing: 10, minBarSpacing: 4};
  return {barSpacing: 8, minBarSpacing: 3};
}

/**
 * Visible time for `setVisibleRange`: first real print → last real print.
 * LWC cannot extrapolate past the last bar; the small right pad is
 * `rightOffset`, not an extension of `to` to now.
 */
export function lwcVisibleTimeRange(
  points: ChartPoint[],
  _now = Date.now(),
): {from: number; to: number} | null {
  if (points.length === 0) return null;
  const from = toUtcSeconds(points[0].t);
  const to = toUtcSeconds(points[points.length - 1].t);
  if (to < from) return null;
  return {from, to};
}

/**
 * Axis for LWC's fit-content default. First print → last print + 8% pad.
 * `now` is unused for the end — kept so tests can prove we ignore it.
 */
export function lwcPlotDomain(
  points: ChartPoint[],
  now = Date.now(),
): {start: number; end: number} {
  const first = points[0]?.t ?? now;
  const last = points[points.length - 1]?.t ?? now;
  const span = last > first ? last - first : 1;
  return {start: first, end: last + span * PLOT_RIGHT_PAD};
}

/**
 * Y-scale when launch / first-print history is in view: floor at that
 * price so a pump rises from the bottom instead of floating mid-axis.
 * Never invents a print; only uses a real floor the caller already has.
 */
export function lwcPriceRange(
  points: ChartPoint[],
  floorPrice?: number | null,
): {min: number; max: number} | null {
  if (points.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const low = point.low ?? point.price;
    const high = point.high ?? point.price;
    if (low > 0 && low < min) min = low;
    if (high > 0 && high > max) max = high;
    if (point.price > 0) {
      if (point.price < min) min = point.price;
      if (point.price > max) max = point.price;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return null;
  if (floorPrice != null && floorPrice > 0) {
    min = Math.min(min, floorPrice);
    max = Math.max(max, floorPrice);
  }
  if (max < min) max = min;
  return {min, max};
}

/** True when the first real print sits inside the visible logical window. */
export function launchInLogicalView(
  range: {from: number; to: number} | null,
): boolean {
  if (range == null) return true;
  return range.from <= 0.75 && range.to >= 0;
}

/**
 * Drop candles that ended before `originMs` (Pons bonded / pair created).
 * A bucket that straddles migrate keeps close + low and drops open/high so
 * a bonding / virtual print cannot become launch mcap or a red wick.
 */
export function clipChartToOrigin(
  points: ChartPoint[],
  originMs?: number,
  bucketMs?: number,
): ChartPoint[] {
  if (
    originMs == null ||
    !Number.isFinite(originMs) ||
    bucketMs == null ||
    !(bucketMs > 0)
  ) {
    return points;
  }

  const kept = points.filter((point) => point.t + bucketMs > originMs);
  if (kept.length === 0) return [];
  const first = kept[0];
  if (first.t >= originMs) return kept;

  const stripped: ChartPoint = {t: first.t, price: first.price};
  if (isFinitePositive(first.low)) stripped.low = first.low;
  return [stripped, ...kept.slice(1)];
}

/**
 * First post-migrate print: low of a straddle bucket, otherwise open/close.
 * Never invents a price — only picks among levels the candle already has.
 */
export function launchPrintPrice(
  first: ChartPoint,
  listedMs?: number,
): number {
  const close = first.price;
  const straddle =
    listedMs != null && Number.isFinite(listedMs) && first.t < listedMs;
  if (straddle && isFinitePositive(first.low)) return first.low;
  if (!straddle && isFinitePositive(first.open)) return first.open;
  return close;
}

export function firstPrintContext(opts: {
  first: ChartPoint | undefined;
  listedAt?: string | null;
  supply?: number | null;
  bucketMs: number;
}): {
  label: "Launch" | "First print";
  t: number;
  price: number;
  mcap: number | null;
} | null {
  const first = opts.first;
  if (!first || !Number.isFinite(first.t) || !(first.price > 0)) return null;

  const listed = opts.listedAt ? Date.parse(opts.listedAt) : NaN;
  const listedMs = Number.isFinite(listed) ? listed : undefined;
  const price = launchPrintPrice(first, listedMs);
  if (!(price > 0)) return null;

  const nearLaunch =
    listedMs != null &&
    Math.abs(first.t - listedMs) <= Math.max(opts.bucketMs * 2, 60_000);
  const supply =
    opts.supply != null && Number.isFinite(opts.supply) && opts.supply > 0
      ? opts.supply
      : null;

  return {
    label: nearLaunch ? "Launch" : "First print",
    t: first.t,
    price,
    mcap: supply != null ? supply * price : null,
  };
}

/**
 * Auto-fit only on first load, interval/style change, or an explicit reset.
 * A user pan plus a live tick or history prepend must leave the window alone.
 */
export function shouldAutoFitVisibleRange(opts: {
  hasFitted: boolean;
  liveEdge: boolean;
  prepend: boolean;
  seriesIdentityChanged: boolean;
}): boolean {
  if (opts.liveEdge || opts.prepend) return false;
  if (!opts.hasFitted) return true;
  return opts.seriesIdentityChanged;
}

/** Older candles prepended; keep the visible window instead of fitting. */
export function isHistoryPrepend(
  prev: ChartPoint[],
  next: ChartPoint[],
): boolean {
  if (prev.length === 0 || next.length <= prev.length) return false;
  const lastPrev = prev[prev.length - 1];
  const lastNext = next[next.length - 1];
  return lastNext.t === lastPrev.t && next[0].t < prev[0].t;
}

/** True when `next` only moved the live edge — safe for `series.update`. */
export function isLiveEdgeUpdate(
  prev: ChartPoint[],
  next: ChartPoint[],
): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  if (next.length < prev.length || next.length > prev.length + 1) return false;

  const shared = Math.min(prev.length, next.length) - 1;
  for (let i = 0; i < shared; i++) {
    if (prev[i].t !== next[i].t || prev[i].price !== next[i].price) return false;
  }

  const lastPrev = prev[prev.length - 1];
  const lastNext = next[next.length - 1];
  if (next.length === prev.length) return lastNext.t === lastPrev.t;
  return lastNext.t > lastPrev.t && next[next.length - 2].t === lastPrev.t;
}

export function mergeChartPoints(
  older: ChartPoint[],
  newer: ChartPoint[],
): ChartPoint[] {
  if (older.length === 0) return newer;
  if (newer.length === 0) return older;
  const byT = new Map<number, ChartPoint>();
  for (const point of older) byT.set(point.t, point);
  for (const point of newer) byT.set(point.t, point);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}
