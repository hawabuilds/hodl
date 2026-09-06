import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  pickEnoughHistory,
  pickEnoughHistoryResolved,
  realHistoricalPoints,
  rhIntervalToTimeframe,
  RH_ENOUGH_TO_DRAW,
  type HistoricalBar,
} from "../src/lib/server/live/robinhood";
import {RWA_TIMEFRAMES, TIMEFRAMES, timeframeLabel} from "../src/lib/types";

function bar(
  t: string,
  close: string,
  interpolated = false,
): HistoricalBar {
  return {begins_at: t, close_price: close, interpolated};
}

describe("RWA historical candles", () => {
  it("drops interpolated gaps and non-positive closes", () => {
    const points = realHistoricalPoints([
      bar("2026-09-01T00:00:00Z", "10"),
      bar("2026-09-02T00:00:00Z", "11", true),
      bar("2026-09-03T00:00:00Z", "0"),
      bar("2026-09-04T00:00:00Z", "12"),
    ]);
    assert.deepEqual(
      points.map((point) => point.price),
      [10, 12],
    );
  });

  it("keeps a short daily series instead of filling with hourly closes", () => {
    const daily = Array.from({length: 3}, (_, i) => ({
      t: i * 86_400_000,
      price: 100 + i,
    }));
    const hourly = Array.from({length: 25}, (_, i) => ({
      t: i * 3_600_000,
      price: 100 + i * 0.1,
    }));
    const picked = pickEnoughHistory([daily, hourly]);
    assert.equal(picked.length, 3);
    assert.equal(picked[0].price, 100);
  });

  it("keeps a coarse series that already has enough real history", () => {
    const daily = Array.from({length: RH_ENOUGH_TO_DRAW}, (_, i) => ({
      t: i * 86_400_000,
      price: 200 + i,
    }));
    const hourly = Array.from({length: 80}, (_, i) => ({
      t: i * 3_600_000,
      price: 1,
    }));
    const picked = pickEnoughHistory([daily, hourly]);
    assert.equal(picked.length, RH_ENOUGH_TO_DRAW);
    assert.equal(picked[0].price, 200);
  });

  it("does not pad a lone close into a chart", () => {
    assert.deepEqual(pickEnoughHistory([[{t: 1, price: 10}]]), []);
  });

  it("reports 1D when the daily series already has a line", () => {
    const daily = Array.from({length: 3}, (_, i) => ({
      t: i * 86_400_000,
      price: 100 + i,
    }));
    const hourly = Array.from({length: 25}, (_, i) => ({
      t: i * 3_600_000,
      price: 100 + i * 0.1,
    }));
    const picked = pickEnoughHistoryResolved([
      {points: daily, timeframe: "1D"},
      {points: hourly, timeframe: "1h"},
    ]);
    assert.equal(picked.resolvedTimeframe, "1D");
    assert.equal(picked.points.length, 3);
    assert.equal(timeframeLabel("1D", picked.resolvedTimeframe), "1D");
  });

  it("does not step down when the requested bucket has no line", () => {
    const daily = [{t: 0, price: 100}];
    const hourly = Array.from({length: 25}, (_, i) => ({
      t: i * 3_600_000,
      price: 100 + i * 0.1,
    }));
    const picked = pickEnoughHistoryResolved([
      {points: daily, timeframe: "1D"},
      {points: hourly, timeframe: "1h"},
    ]);
    assert.equal(picked.resolvedTimeframe, null);
    assert.equal(picked.points.length, 0);
  });

  it("maps Robinhood intervals onto app timeframes", () => {
    assert.equal(rhIntervalToTimeframe("day"), "1D");
    assert.equal(rhIntervalToTimeframe("hour"), "1h");
    assert.equal(rhIntervalToTimeframe("5minute"), "5m");
    assert.equal(rhIntervalToTimeframe("10minute"), "15m");
  });

  it("offers only 5m / 1h / 1D pills for stock charts", () => {
    assert.deepEqual([...RWA_TIMEFRAMES], ["5m", "1h", "1D"]);
    for (const missing of ["1m", "15m", "4h"] as const) {
      assert.equal((RWA_TIMEFRAMES as readonly string[]).includes(missing), false);
      assert.equal((TIMEFRAMES as readonly string[]).includes(missing), true);
    }
  });
});
