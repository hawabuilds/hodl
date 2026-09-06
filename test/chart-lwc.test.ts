import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  LWC_ATTRIBUTION_LOGO,
  LWC_RIGHT_OFFSET_BARS,
  candleFromPoint,
  clipChartToOrigin,
  firstPrintContext,
  isHistoryPrepend,
  isLiveEdgeUpdate,
  isLwcWhitespace,
  isPlausiblePrice,
  launchInLogicalView,
  launchPrintPrice,
  lwcBarSpacing,
  lwcCandleStyleOptions,
  lwcLayoutOptions,
  lwcPlotDomain,
  lwcPriceRange,
  lwcTimeScaleOptions,
  lwcVisibleTimeRange,
  rightPadBars,
  shouldAutoFitVisibleRange,
  toCandleData,
  toLineData,
  toUtcSeconds,
  withCompressedSessionBreaks,
} from "../src/lib/chartLwc";
import {
  PLOT_GAP_COMPRESS_BARS,
  PLOT_RIGHT_PAD,
  TIMEFRAME_MS,
  chartWindowMs,
  gapBreakMsForWindow,
  pointsMatchInterval,
} from "../src/lib/chartPlot";
import {mergeTradesIntoChart} from "../src/lib/chartLive";
import {candleLadder, pickResolvedCandles} from "../src/lib/server/live/geckoterminal";
import type {Trade} from "../src/lib/types";
import {realHistoricalPoints} from "../src/lib/server/live/robinhood";
import {realOhlcvCloses} from "../src/lib/server/live/geckoterminal";
import type {ChartPoint} from "../src/lib/types";

function pt(
  t: number,
  price: number,
  ohlc?: {open?: number; high?: number; low?: number},
): ChartPoint {
  return {t, price, ...ohlc};
}

describe("LWC domain", () => {
  it("sizes the axis to real prints plus an 8% right pad, not now", () => {
    const now = 10_000;
    const points = [pt(1_000, 2), pt(2_000, 2.1)];
    const range = lwcPlotDomain(points, now);
    assert.equal(range.start, 1_000);
    assert.equal(range.end, 2_000 + 1_000 * PLOT_RIGHT_PAD);
    assert.ok(range.end < now);
  });

  it("does not stretch a 20-minute tape across a 1D window", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const first = now - 20 * 60_000;
    const last = now - 30_000;
    const range = lwcPlotDomain([pt(first, 1), pt(last, 1.1)], now);
    assert.equal(range.start, first);
    assert.equal(range.end, last + (last - first) * PLOT_RIGHT_PAD);
    assert.ok(range.end - range.start < chartWindowMs("1D") / 100);
    assert.notEqual(range.end, now);
  });

  it("right-pad is a few empty bars, not a pad-to-now", () => {
    assert.equal(rightPadBars(100), 8);
    assert.ok(rightPadBars(12) >= 2);
    assert.ok(rightPadBars(1000) <= 8);
    assert.equal(lwcTimeScaleOptions().rightOffset, LWC_RIGHT_OFFSET_BARS);
    assert.ok(lwcTimeScaleOptions().rightOffsetPixels <= 32);
  });

  it("does not lock the right edge so a left pan can stay on older candles", () => {
    const opts = lwcTimeScaleOptions({intraday: true, barCount: 200});
    assert.equal(opts.fixRightEdge, false);
    assert.equal(opts.lockVisibleTimeRangeOnResize, false);
    assert.equal(opts.fixLeftEdge, true);
    assert.equal(opts.rightOffset, LWC_RIGHT_OFFSET_BARS);
  });

  it("visible time range is first print to last print, never now", () => {
    const now = 10_000_000;
    const points = [pt(1_000, 2), pt(2_000, 2.1)];
    const range = lwcVisibleTimeRange(points, now);
    assert.deepEqual(range, {
      from: toUtcSeconds(1_000),
      to: toUtcSeconds(2_000),
    });
    assert.ok(range && range.to < toUtcSeconds(now));
  });
});

describe("LWC attribution", () => {
  it("does not show the TradingView logo on the chart", () => {
    assert.equal(LWC_ATTRIBUTION_LOGO, false);
    assert.equal(lwcLayoutOptions().attributionLogo, false);
  });
});

describe("launch Y-scale", () => {
  it("floors the visible range at the first-print price", () => {
    const points = [
      pt(0, 0.01),
      pt(60_000, 0.04),
      pt(120_000, 0.08, {high: 0.09, low: 0.035}),
    ];
    const range = lwcPriceRange(points, 0.01);
    assert.equal(range?.min, 0.01);
    assert.equal(range?.max, 0.09);
  });

  it("does not invent a floor below the first real print", () => {
    const range = lwcPriceRange([pt(0, 2), pt(1, 3)], null);
    assert.equal(range?.min, 2);
    assert.equal(launchInLogicalView({from: 0, to: 10}), true);
    assert.equal(launchInLogicalView({from: 20, to: 40}), false);
  });
});

describe("candle toggle data", () => {
  it("uses real OHLC when the provider sent it", () => {
    const candle = candleFromPoint(
      pt(1_000, 12, {open: 10, high: 13, low: 9}),
    );
    assert.deepEqual(candle, {
      time: toUtcSeconds(1_000),
      open: 10,
      high: 13,
      low: 9,
      close: 12,
    });
  });

  it("does not paint a wick to a 0 or wei low", () => {
    const candle = candleFromPoint(
      pt(1_000, 0.0013, {open: 0.0012, high: 0.0014, low: 0}),
    );
    assert.equal(candle.low, Math.min(0.0012, 0.0013));
    assert.ok(candle.low > 0);
    const wei = candleFromPoint(
      pt(1_000, 0.0013, {open: 0.0012, high: 0.0014, low: 1.44e-15}),
    );
    assert.equal(wei.low, Math.min(0.0012, 0.0013));
  });

  it("does not invent wicks on a close-only series", () => {
    const candles = toCandleData([pt(0, 10), pt(60_000, 11), pt(120_000, 10.5)]);
    assert.equal(candles.length, 3);
    assert.equal(candles[0].open, 10);
    assert.equal(candles[0].high, 10);
    assert.equal(candles[0].low, 10);
    assert.equal(candles[1].open, 10);
    assert.equal(candles[1].close, 11);
    assert.equal(candles[1].high, 11);
    assert.equal(candles[1].low, 10);
    assert.equal(candles[2].open, 11);
    assert.equal(candles[2].close, 10.5);
  });

  it("keeps gecko OHLC on the close series the line already used", () => {
    const points = realOhlcvCloses([
      [1_800, 2, 2.2, 1.8, 2, 0],
      [1_200, 2.9, 3.2, 2.8, 3, 10],
      [600, 1, 1.1, 0.9, 1, 4],
    ]);
    assert.deepEqual(
      points.map((point) => point.price),
      [1, 3],
    );
    assert.equal(points[0].open, 1);
    assert.equal(points[0].high, 1.1);
    assert.equal(points[1].high, 3.2);
    const candles = toCandleData(points);
    assert.equal(candles[0].high, 1.1);
    assert.equal(candles[1].low, 2.8);
  });

  it("line data is the same closes the header already reads", () => {
    const points = [pt(1_000, 2), pt(2_000, 2.5)];
    assert.deepEqual(toLineData(points), [
      {time: 1, value: 2},
      {time: 2, value: 2.5},
    ]);
  });
});

describe("RWA closed-session handling", () => {
  it("drops interpolated weekend bars and never forward-fills them", () => {
    const friday = "2026-09-04T20:00:00.000Z";
    const sunday = "2026-09-06T20:00:00.000Z";
    const monday = "2026-09-07T13:30:00.000Z";
    const points = realHistoricalPoints([
      {begins_at: friday, close_price: "100", interpolated: false},
      {begins_at: sunday, close_price: "100.4", interpolated: true},
      {begins_at: monday, close_price: "101", interpolated: false},
    ]);
    assert.equal(points.length, 2);
    assert.deepEqual(
      points.map((point) => point.price),
      [100, 101],
    );
    assert.ok(
      points[1].t - points[0].t > TIMEFRAME_MS["1D"],
      "calendar hole stays in the timestamps",
    );
  });

  it("compresses a weekend to a few empty slots instead of calendar width", () => {
    const friday = Date.parse("2026-09-04T20:00:00.000Z");
    const monday = Date.parse("2026-09-07T13:30:00.000Z");
    const points = [pt(friday, 100), pt(monday, 101)];
    const bars = toLineData(points);
    const withBreaks = withCompressedSessionBreaks(
      bars,
      points.map((point) => point.t),
      gapBreakMsForWindow(chartWindowMs("1D")),
    );
    const whitespace = withBreaks.filter((item) => isLwcWhitespace(item));
    const priced = withBreaks.filter((item) => !isLwcWhitespace(item));
    assert.equal(priced.length, 2);
    assert.equal(whitespace.length, PLOT_GAP_COMPRESS_BARS);
    assert.equal(withBreaks.length, 2 + PLOT_GAP_COMPRESS_BARS);
    const holeHours = (monday - friday) / TIMEFRAME_MS["1h"];
    assert.ok(holeHours > 48);
    assert.ok(
      withBreaks.length < holeHours / 4,
      "closed session is a few slots, not calendar hours",
    );
  });

  it("does not invent a Sunday print to keep the line connected", () => {
    const friday = Date.parse("2026-09-04T20:00:00.000Z");
    const monday = Date.parse("2026-09-07T13:30:00.000Z");
    const withBreaks = withCompressedSessionBreaks(
      toLineData([pt(friday, 100), pt(monday, 101)]),
      [friday, monday],
      TIMEFRAME_MS["1D"] * 1.5,
    );
    for (const item of withBreaks) {
      if (!isLwcWhitespace(item) && "value" in item) {
        assert.ok(item.value === 100 || item.value === 101);
      }
    }
  });

  it("keeps 5m RWA as one session so empty minutes stay connected", () => {
    const minute = TIMEFRAME_MS["5m"];
    const points = [pt(0, 10), pt(minute * 3, 10.1)];
    const withBreaks = withCompressedSessionBreaks(
      toLineData(points),
      points.map((point) => point.t),
      gapBreakMsForWindow(chartWindowMs("5m")),
    );
    assert.equal(withBreaks.length, 2);
    assert.equal(withBreaks.filter((item) => isLwcWhitespace(item)).length, 0);
  });
});

describe("live edge and older history", () => {
  it("treats a newer last print as a live-edge update", () => {
    const prev = [pt(1, 1), pt(2, 1.1)];
    assert.equal(isLiveEdgeUpdate(prev, [pt(1, 1), pt(2, 1.2)]), true);
    assert.equal(isLiveEdgeUpdate(prev, [pt(1, 1), pt(2, 1.1), pt(3, 1.2)]), true);
    assert.equal(isLiveEdgeUpdate(prev, [pt(0, 0.9), pt(1, 1), pt(2, 1.1)]), false);
  });

  it("detects older candles prepended without moving the tip", () => {
    const prev = [pt(10, 1), pt(20, 1.1)];
    const next = [pt(0, 0.8), pt(10, 1), pt(20, 1.1)];
    assert.equal(isHistoryPrepend(prev, next), true);
    assert.equal(isLiveEdgeUpdate(prev, next), false);
  });

  it("does not reset the visible range after the user panned and a live tick arrives", () => {
    const prev = [pt(1, 1), pt(2, 1.1), pt(3, 1.2), pt(4, 1.3)];
    const next = [pt(1, 1), pt(2, 1.1), pt(3, 1.2), pt(4, 1.35)];
    assert.equal(isLiveEdgeUpdate(prev, next), true);
    assert.equal(
      shouldAutoFitVisibleRange({
        hasFitted: true,
        liveEdge: true,
        prepend: false,
        seriesIdentityChanged: false,
      }),
      false,
    );
    assert.equal(
      shouldAutoFitVisibleRange({
        hasFitted: true,
        liveEdge: true,
        prepend: false,
        seriesIdentityChanged: true,
      }),
      false,
    );
  });

  it("still auto-fits on first load and interval change, not on prepend", () => {
    assert.equal(
      shouldAutoFitVisibleRange({
        hasFitted: false,
        liveEdge: false,
        prepend: false,
        seriesIdentityChanged: false,
      }),
      true,
    );
    assert.equal(
      shouldAutoFitVisibleRange({
        hasFitted: true,
        liveEdge: false,
        prepend: false,
        seriesIdentityChanged: true,
      }),
      true,
    );
    assert.equal(
      shouldAutoFitVisibleRange({
        hasFitted: true,
        liveEdge: false,
        prepend: true,
        seriesIdentityChanged: false,
      }),
      false,
    );
  });
});

describe("first print / launch mcap", () => {
  it("labels launch only when listed_at is next to the first real print", () => {
    const listed = "2026-09-01T12:00:00.000Z";
    const first = pt(Date.parse(listed) + 30_000, 0.01);
    const launch = firstPrintContext({
      first,
      listedAt: listed,
      supply: 1_000_000,
      bucketMs: TIMEFRAME_MS["1m"],
    });
    assert.equal(launch?.label, "Launch");
    assert.equal(launch?.mcap, 10_000);
  });

  it("does not call a later first candle the launch cap", () => {
    const ctx = firstPrintContext({
      first: pt(Date.parse("2026-09-06T12:00:00.000Z"), 0.02),
      listedAt: "2026-08-01T12:00:00.000Z",
      supply: 1_000_000,
      bucketMs: TIMEFRAME_MS["5m"],
    });
    assert.equal(ctx?.label, "First print");
    assert.equal(ctx?.mcap, 20_000);
  });

  it("uses the post-migrate low, not a 300k bonding close, for Pons launch", () => {
    const listed = "2026-09-06T13:26:52.000Z";
    const first = pt(Date.parse("2026-09-06T13:25:00.000Z"), 0.000306536999632287, {
      open: 0.000274297212557981,
      high: 0.000565308143904418,
      low: 0.0000307056533985785,
    });
    const ctx = firstPrintContext({
      first,
      listedAt: listed,
      supply: 1_000_000_000,
      bucketMs: TIMEFRAME_MS["5m"],
    });
    assert.equal(ctx?.label, "Launch");
    assert.equal(ctx?.price, 0.0000307056533985785);
    assert.ok((ctx?.mcap ?? 0) < 50_000);
    assert.ok((ctx?.mcap ?? 0) > 20_000);
    assert.ok(1_000_000_000 * 0.000306536999632287 > 300_000);
  });

  it("omits mcap when supply is unknown rather than inventing one", () => {
    const ctx = firstPrintContext({
      first: pt(1_000, 0.5),
      listedAt: null,
      supply: null,
      bucketMs: TIMEFRAME_MS["1h"],
    });
    assert.equal(ctx?.label, "First print");
    assert.equal(ctx?.mcap, null);
  });
});

function tradeAt(at: string, priceUsd: number, id = "1"): Trade {
  return {
    id,
    side: "buy",
    amount: 1,
    amountUsd: priceUsd,
    priceUsd,
    maker: "0xmaker",
    txHash: `0x${id}`,
    makerHandle: null,
    at,
  };
}

describe("candle period matches the selected interval", () => {
  it("keeps 5m candles on a 5m tab even when 1m has more bars", () => {
    const fiveMin = Array.from({length: 4}, (_, i) =>
      pt(i * TIMEFRAME_MS["5m"], 1 + i * 0.01),
    );
    const oneMin = Array.from({length: 20}, (_, i) =>
      pt(i * TIMEFRAME_MS["1m"], 1 + i * 0.001),
    );
    assert.deepEqual(candleLadder("5m"), ["5m"]);
    const picked = pickResolvedCandles("5m", {"5m": fiveMin, "1m": oneMin});
    assert.equal(picked.resolvedTimeframe, "5m");
    assert.equal(picked.points.length, 4);
    assert.equal(pointsMatchInterval(picked.points, TIMEFRAME_MS["5m"]), true);
    assert.equal(pointsMatchInterval(picked.points, TIMEFRAME_MS["1m"]), false);
  });

  it("stays empty on 5m when that bucket cannot form a line", () => {
    const picked = pickResolvedCandles("5m", {
      "5m": [pt(0, 1)],
      "1m": Array.from({length: 12}, (_, i) => pt(i * TIMEFRAME_MS["1m"], 1)),
    });
    assert.equal(picked.resolvedTimeframe, "5m");
    assert.equal(picked.points.length, 0);
  });

  it("folds live fills into the 5m bucket instead of painting 1m ticks", () => {
    const last = 1_700_000_100_000;
    const points = [
      pt(last - TIMEFRAME_MS["5m"], 1),
      pt(last, 1.1, {open: 1, high: 1.1, low: 1}),
    ];
    const merged = mergeTradesIntoChart(
      points,
      [
        tradeAt(new Date(last + 30_000).toISOString(), 1.2, "a"),
        tradeAt(new Date(last + 90_000).toISOString(), 1.05, "b"),
        tradeAt(new Date(last + TIMEFRAME_MS["5m"] + 10_000).toISOString(), 1.3, "c"),
      ],
      TIMEFRAME_MS["5m"],
    );
    assert.equal(merged.length, 3);
    assert.equal(merged[1].t, last);
    assert.equal(merged[1].price, 1.05);
    assert.equal(merged[1].high, 1.2);
    assert.equal(merged[2].t, last + TIMEFRAME_MS["5m"]);
    assert.equal(pointsMatchInterval(merged, TIMEFRAME_MS["5m"]), true);
  });

  it("drops a wei / dust live print so it cannot wick the current candle to 0", () => {
    const last = Date.parse("2026-09-06T14:48:00.000Z");
    const points = [
      pt(last - TIMEFRAME_MS["1m"], 0.00135),
      pt(last, 0.00137, {open: 0.00135, high: 0.00138, low: 0.00135}),
    ];
    const merged = mergeTradesIntoChart(
      points,
      [
        {
          ...tradeAt(new Date(last + 15_000).toISOString(), 1.4387264037193522e-15, "wei"),
          amountUsd: 8.92741863e-10,
          amount: 620508.4307149091,
        },
        tradeAt(new Date(last + 20_000).toISOString(), 0.00136, "ok"),
      ],
      TIMEFRAME_MS["1m"],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[1].price, 0.00136);
    assert.ok((merged[1].low ?? merged[1].price) > 0.001);
    assert.equal(isPlausiblePrice(1.4387264037193522e-15, 0.00137), false);
  });
});

describe("post-migrate origin", () => {
  it("strips a bonding open/high from the bucket that straddles listed_at", () => {
    const listed = Date.parse("2026-09-06T13:26:52.000Z");
    const first = pt(Date.parse("2026-09-06T13:25:00.000Z"), 0.000306, {
      open: 0.000274,
      high: 0.000565,
      low: 0.0000307,
    });
    const later = pt(Date.parse("2026-09-06T13:30:00.000Z"), 0.00047);
    const clipped = clipChartToOrigin([first, later], listed, TIMEFRAME_MS["5m"]);
    assert.equal(clipped.length, 2);
    assert.equal(clipped[0].open, undefined);
    assert.equal(clipped[0].high, undefined);
    assert.equal(clipped[0].low, 0.0000307);
    assert.equal(clipped[0].price, 0.000306);
    assert.equal(launchPrintPrice(clipped[0], listed), 0.0000307);
  });
});

describe("1m candle styling", () => {
  it("uses filled bodies and thicker bars on a short 1m tape", () => {
    const style = lwcCandleStyleOptions({green: "#00c805", red: "#ff5a52"});
    assert.equal(style.borderVisible, true);
    assert.equal(style.upColor, "#00c805");
    assert.equal(style.downColor, "#ff5a52");
    assert.equal(style.borderUpColor, "#00c805");
    assert.equal(style.wickDownColor, "#ff5a52");
    const young = lwcBarSpacing(12, true);
    assert.ok(young.barSpacing >= 12);
    assert.ok(young.minBarSpacing >= 4);
    const daily = lwcBarSpacing(200, false);
    assert.equal(daily.minBarSpacing, 0.5);
    assert.ok(lwcTimeScaleOptions({intraday: true, barCount: 12}).minBarSpacing >= 4);
  });
});
