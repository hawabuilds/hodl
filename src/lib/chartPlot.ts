import type {ChartPoint, Timeframe} from "@/lib/types";

/** Width of one requested bucket. Used for the axis window and gap breaks. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1D": 86_400_000,
};

/** How many buckets a default zoomed-in view covers. Gap policy still uses this. */
export const CHART_WINDOW_BARS = 120;

/** Widest history one chart request asks for. Gecko's OHLCV ceiling is 1000. */
export const CHART_HISTORY_BARS = 1000;

export function chartWindowMs(timeframe: Timeframe): number {
  return TIMEFRAME_MS[timeframe] * CHART_WINDOW_BARS;
}

export function medianStep(points: ChartPoint[]): number | null {
  const dts: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) dts.push(dt);
  }
  if (dts.length === 0) return null;
  const sorted = [...dts].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * True when the series is the requested bucket — 5m tab = 5m candles.
 * Session holes (RWA weekends) do not count; the median step does.
 */
export function pointsMatchInterval(
  points: ChartPoint[],
  intervalMs: number,
  slack = 0.25,
): boolean {
  if (!(intervalMs > 0)) return false;
  if (points.length <= 1) return true;
  const step = medianStep(points);
  if (step == null) return false;
  return step >= intervalMs * (1 - slack) && step <= intervalMs * (1 + slack);
}

/**
 * Extra room after the last real print so the newest candle is not jammed
 * against the right edge. Does not extend the axis to "now".
 */
export const PLOT_RIGHT_PAD = 0.08;

/**
 * A hole larger than this many buckets is drawn as this many buckets of
 * x-space. Real empty time is still a gap (or a connected 1m/5m line); we
 * just do not let a silent day dominate the width the way Gecko/Dex skip
 * empty candles.
 */
export const PLOT_GAP_COMPRESS_BARS = 3;

/** Cap on visual gap width for a `windowMs` axis. */
export function gapCompressMsForWindow(windowMs?: number): number | undefined {
  if (windowMs == null || windowMs <= 0) return undefined;
  return (windowMs / CHART_WINDOW_BARS) * PLOT_GAP_COMPRESS_BARS;
}

/**
 * X-axis for a price line.
 *
 * Domain is the real series — first print to last print — plus a small
 * right-hand pad. A 20-minute tape is a 20-minute axis. `windowMs` is not
 * used here; it only sizes gap breaks in the caller.
 */
export function plotRange(
  points: ChartPoint[],
  _windowMs?: number,
  now = Date.now(),
): {start: number; end: number} {
  const first = points[0]?.t ?? now;
  const last = points[points.length - 1]?.t ?? now;
  const span = last > first ? last - first : 1;
  return {start: first, end: last + span * PLOT_RIGHT_PAD};
}

/** Points that actually sit inside the axis. Never invents a print at `end`. */
export function pointsInRange(
  points: ChartPoint[],
  start: number,
  end: number,
): ChartPoint[] {
  return points.filter((point) => point.t >= start && point.t <= end);
}

/**
 * How far apart two real prints can be before the line breaks.
 *
 * 1m and 5m stay one polyline: empty minutes are normal on a DEX tape,
 * not holes. Coarser pills still break on a weekend or a silent afternoon.
 * `Infinity` means "never break".
 */
export function gapBreakMs(timeframe: Timeframe): number {
  if (timeframe === "1m" || timeframe === "5m") return Number.POSITIVE_INFINITY;
  return TIMEFRAME_MS[timeframe] * 1.5;
}

/**
 * Gap policy for a `windowMs` axis. Unknown windows keep the median-step
 * default inside `splitOnGaps`.
 */
export function gapBreakMsForWindow(windowMs?: number): number | undefined {
  if (windowMs == null || windowMs <= 0) return undefined;
  const bucket = windowMs / CHART_WINDOW_BARS;
  if (bucket <= TIMEFRAME_MS["5m"]) return Number.POSITIVE_INFINITY;
  return bucket * 1.5;
}

/**
 * Split a series wherever the gap is bigger than a real bucket.
 *
 * A missing candle is a hole, not a flat hold — except on 1m/5m, where
 * callers pass `Infinity` so real prints stay connected. Default threshold
 * is 1.5× the median step so regular hourly prints stay connected and a
 * weekend or a silent afternoon breaks.
 */
export function splitOnGaps(
  points: ChartPoint[],
  gapMs?: number,
): ChartPoint[][] {
  if (points.length === 0) return [];
  const step = gapMs ?? (medianStep(points) ?? 0) * 1.5;
  if (step <= 0) return [points];

  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > step) {
      if (current.length > 0) segments.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function xAt(
  t: number,
  start: number,
  end: number,
  width: number,
): number {
  const span = end - start || 1;
  return ((t - start) / span) * width;
}

/**
 * Linear x, except holes wider than `maxGapMs` occupy only `maxGapMs` of
 * visual time. `end` includes the right-hand pad. No maxGap → `xAt`.
 */
export function xAtCompressed(
  t: number,
  points: ChartPoint[],
  width: number,
  maxGapMs?: number,
): number {
  const {start, end} = plotRange(points);
  if (maxGapMs == null || maxGapMs <= 0 || points.length < 2) {
    return xAt(t, start, end, width);
  }

  const visual: number[] = [points[0].t];
  for (let i = 1; i < points.length; i++) {
    const dt = Math.max(0, points[i].t - points[i - 1].t);
    visual.push(visual[i - 1] + Math.min(dt, maxGapMs));
  }

  const firstV = visual[0];
  const lastV = visual[visual.length - 1];
  const dataSpan = lastV > firstV ? lastV - firstV : 1;
  const visualEnd = lastV + dataSpan * PLOT_RIGHT_PAD;

  let v: number;
  if (t <= points[0].t) {
    v = firstV;
  } else if (t >= points[points.length - 1].t) {
    v = lastV;
  } else {
    let i = 1;
    while (i < points.length && points[i].t < t) i++;
    const t0 = points[i - 1].t;
    const t1 = points[i].t;
    const v0 = visual[i - 1];
    const v1 = visual[i];
    const ratio = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    v = v0 + (v1 - v0) * ratio;
  }

  return xAt(v, firstV, visualEnd, width);
}
