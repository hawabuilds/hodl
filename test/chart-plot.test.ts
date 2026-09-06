import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  PLOT_GAP_COMPRESS_BARS,
  PLOT_RIGHT_PAD,
  TIMEFRAME_MS,
  chartWindowMs,
  gapBreakMs,
  gapBreakMsForWindow,
  gapCompressMsForWindow,
  plotRange,
  pointsInRange,
  pointsMatchInterval,
  splitOnGaps,
  xAt,
  xAtCompressed,
} from "../src/lib/chartPlot";
import type {ChartPoint} from "../src/lib/types";

function pt(t: number, price = 1): ChartPoint {
  return {t, price};
}

describe("chart plot range", () => {
  it("does not extend a short series to now when no window is set", () => {
    const points = [pt(1_000, 1), pt(2_000, 2)];
    const range = plotRange(points, undefined, 10_000);
    assert.equal(range.start, 1_000);
    assert.equal(range.end, 2_000 + 1_000 * PLOT_RIGHT_PAD);
    assert.ok(range.end < 10_000);
  });

  it("sizes the axis to real prints plus a small right pad, not the 1D window", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const first = now - 20 * 60_000;
    const last = now - 30_000;
    const points = [pt(first, 1), pt(last, 1.1)];
    const range = plotRange(points, chartWindowMs("1D"), now);
    const dayWindow = chartWindowMs("1D");
    assert.equal(range.start, first);
    assert.equal(range.end, last + (last - first) * PLOT_RIGHT_PAD);
    assert.ok(range.end - range.start < dayWindow / 100);
    const lastX = xAt(last, range.start, range.end, 100);
    assert.ok(lastX > 90);
    assert.ok(lastX < 100);
    assert.equal(xAt(first, range.start, range.end, 100), 0);
  });

  it("never invents a point at now when the series ended earlier", () => {
    const now = 10_000;
    const points = [pt(1_000, 2), pt(2_000, 2)];
    const range = plotRange(points, 8_000, now);
    const visible = pointsInRange(points, range.start, range.end);
    assert.equal(visible.at(-1)?.t, 2_000);
    assert.notEqual(visible.at(-1)?.t, now);
    assert.ok(range.end < now);
  });
});

describe("chart gaps", () => {
  it("breaks a weekend-sized hole on daily closes", () => {
    const friday = Date.parse("2026-09-04T00:00:00.000Z");
    const monday = Date.parse("2026-09-07T00:00:00.000Z");
    const segments = splitOnGaps(
      [pt(friday, 100), pt(monday, 101)],
      TIMEFRAME_MS["1D"] * 1.5,
    );
    assert.equal(segments.length, 2);
    assert.equal(segments[0].length, 1);
    assert.equal(segments[1].length, 1);
  });

  it("keeps adjacent hourly prints connected", () => {
    const hour = TIMEFRAME_MS["1h"];
    const segments = splitOnGaps(
      [pt(0, 1), pt(hour, 1.1), pt(hour * 2, 1.2)],
      hour * 1.5,
    );
    assert.equal(segments.length, 1);
    assert.equal(segments[0].length, 3);
  });

  it("breaks a silent afternoon on hourly prints", () => {
    const hour = TIMEFRAME_MS["1h"];
    const segments = splitOnGaps(
      [pt(0, 1), pt(hour, 1.1), pt(hour * 5, 1.1)],
      hour * 1.5,
    );
    assert.equal(segments.length, 2);
  });

  it("no longer breaks 1m after a 90-second quiet spell", () => {
    const minute = TIMEFRAME_MS["1m"];
    const sparse = [pt(0, 1), pt(minute * 2, 1.1)];
    assert.equal(splitOnGaps(sparse, minute * 1.5).length, 2);
    assert.equal(splitOnGaps(sparse, gapBreakMs("1m")).length, 1);
  });

  it("keeps a 1m series with missing minutes as one polyline", () => {
    const minute = TIMEFRAME_MS["1m"];
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const points = [
      pt(now - 10 * minute, 1),
      pt(now - 8 * minute, 1.02),
      pt(now - 5 * minute, 1.04),
      pt(now - 2 * minute, 1.05),
    ];
    const range = plotRange(points, chartWindowMs("1m"), now);
    const visible = pointsInRange(points, range.start, range.end);
    const segments = splitOnGaps(visible, gapBreakMs("1m"));
    assert.equal(segments.length, 1);
    assert.equal(segments[0].length, 4);
    assert.equal(visible.at(-1)?.t, now - 2 * minute);
    assert.notEqual(visible.at(-1)?.t, now);
  });

  it("does not break 5m on a two-bucket quiet spell", () => {
    const five = TIMEFRAME_MS["5m"];
    const segments = splitOnGaps(
      [pt(0, 1), pt(five, 1.1), pt(five * 4, 1.2)],
      gapBreakMs("5m"),
    );
    assert.equal(segments.length, 1);
    assert.equal(segments[0].length, 3);
  });

  it("draws a two-day 1D series across the width instead of the right edge", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const first = Date.parse("2026-09-05T00:00:00.000Z");
    const last = Date.parse("2026-09-06T00:00:00.000Z");
    const points = [pt(first, 1), pt(last, 1.1)];
    const range = plotRange(points, chartWindowMs("1D"), now);
    const visible = pointsInRange(points, range.start, range.end);
    const segments = splitOnGaps(visible, gapBreakMs("1D"));
    assert.equal(segments.length, 1);
    assert.equal(visible.at(-1)?.t, last);
    const lastX = xAt(last, range.start, range.end, 120);
    assert.ok(lastX > 100);
    assert.ok(lastX < 120);
    assert.ok(range.end < now);
  });

  it("uses Infinity for 1m/5m windows and 1.5 buckets for 1D", () => {
    assert.equal(gapBreakMs("1m"), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMs("5m"), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMsForWindow(chartWindowMs("1m")), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMsForWindow(chartWindowMs("5m")), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMs("1D"), TIMEFRAME_MS["1D"] * 1.5);
    assert.equal(gapBreakMsForWindow(chartWindowMs("1D")), TIMEFRAME_MS["1D"] * 1.5);
    assert.equal(gapBreakMsForWindow(undefined), undefined);
    assert.equal(
      gapCompressMsForWindow(chartWindowMs("1m")),
      TIMEFRAME_MS["1m"] * PLOT_GAP_COMPRESS_BARS,
    );
    assert.equal(gapCompressMsForWindow(undefined), undefined);
  });

  it("compresses a day-long hole on 1m so the chart is not mostly blank", () => {
    const minute = TIMEFRAME_MS["1m"];
    const points = [
      pt(0, 1),
      pt(minute, 1.1),
      pt(minute + 24 * 60 * minute, 1.2),
      pt(minute + 24 * 60 * minute + minute, 1.3),
    ];
    const maxGap = minute * PLOT_GAP_COMPRESS_BARS;
    const lastX = xAtCompressed(points[3].t, points, 100, maxGap);
    const midGap = xAtCompressed(points[1].t + 12 * 60 * minute, points, 100, maxGap);
    assert.ok(lastX > 90);
    assert.ok(lastX < 100);
    assert.ok(midGap < 70);
  });

  it("treats a 5m series as 5-minute candles, not 1m", () => {
    const step = TIMEFRAME_MS["5m"];
    const points = [pt(0), pt(step), pt(step * 2), pt(step * 3)];
    assert.equal(pointsMatchInterval(points, TIMEFRAME_MS["5m"]), true);
    assert.equal(pointsMatchInterval(points, TIMEFRAME_MS["1m"]), false);
  });
});
