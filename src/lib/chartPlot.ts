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

/** How many buckets the selected pill is meant to show. Matches the Gecko limit. */
export const CHART_WINDOW_BARS = 120;

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
 * X-axis for a price line.
 *
 * When `windowMs` is set the domain ends at `now` and starts `windowMs`
 * earlier. The last real print is not stretched to the right edge, and a
 * young series is a short line inside a longer window.
 *
 * Without a window the domain is the data extent — portfolio equity, which
 * has its own range filter already.
 */
export function plotRange(
  points: ChartPoint[],
  windowMs?: number,
  now = Date.now(),
): {start: number; end: number} {
  if (windowMs != null && windowMs > 0) {
    return {start: now - windowMs, end: now};
  }
  const first = points[0]?.t ?? now;
  const last = points[points.length - 1]?.t ?? now;
  return {start: first, end: last > first ? last : first + 1};
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
