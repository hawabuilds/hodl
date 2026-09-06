import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  CHART_WINDOW_BARS,
  TIMEFRAME_MS,
  chartWindowMs,
  gapBreakMs,
  gapBreakMsForWindow,
  plotRange,
  pointsInRange,
  splitOnGaps,
  xAt,
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
    assert.equal(range.end, 2_000);
  });

  it("ends the 1D window at now so a young pool is a short line", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const points = [
      pt(Date.parse("2026-09-05T00:00:00.000Z"), 1),
      pt(Date.parse("2026-09-06T00:00:00.000Z"), 1.1),
    ];
    const range = plotRange(points, chartWindowMs("1D"), now);
    assert.equal(range.end, now);
    assert.equal(range.start, now - TIMEFRAME_MS["1D"] * CHART_WINDOW_BARS);
    const visible = pointsInRange(points, range.start, range.end);
    assert.equal(visible.length, 2);
    const lastX = xAt(visible[1].t, range.start, range.end, 120);
    assert.ok(lastX < 120);
    assert.ok(lastX > 100);
  });

  it("never invents a point at the window end", () => {
    const now = 10_000;
    const points = [pt(1_000, 2), pt(2_000, 2)];
    const range = plotRange(points, 8_000, now);
    const visible = pointsInRange(points, range.start, range.end);
    assert.equal(visible.at(-1)?.t, 2_000);
    assert.notEqual(visible.at(-1)?.t, now);
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

  it("still leaves a young 1D series short of now", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const last = Date.parse("2026-09-06T00:00:00.000Z");
    const points = [pt(Date.parse("2026-09-05T00:00:00.000Z"), 1), pt(last, 1.1)];
    const range = plotRange(points, chartWindowMs("1D"), now);
    const visible = pointsInRange(points, range.start, range.end);
    const segments = splitOnGaps(visible, gapBreakMs("1D"));
    assert.equal(segments.length, 1);
    assert.equal(visible.at(-1)?.t, last);
    assert.ok(xAt(last, range.start, range.end, 120) < 120);
  });

  it("uses Infinity for 1m/5m windows and 1.5 buckets for 1D", () => {
    assert.equal(gapBreakMs("1m"), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMs("5m"), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMsForWindow(chartWindowMs("1m")), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMsForWindow(chartWindowMs("5m")), Number.POSITIVE_INFINITY);
    assert.equal(gapBreakMs("1D"), TIMEFRAME_MS["1D"] * 1.5);
    assert.equal(gapBreakMsForWindow(chartWindowMs("1D")), TIMEFRAME_MS["1D"] * 1.5);
    assert.equal(gapBreakMsForWindow(undefined), undefined);
  });
});
