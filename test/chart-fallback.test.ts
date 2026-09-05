import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {mergeTradesIntoChart} from "../src/lib/chartLive";
import {
  chartPointsFromPair,
  seriesFrom,
  type DexPair,
} from "../src/lib/server/live/dexscreener";
import type {Trade} from "../src/lib/types";

function pair(change: DexPair["priceChange"], priceUsd = "1"): DexPair {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    pairAddress: "0xpool",
    baseToken: {address: "0xtoken", name: "Tok", symbol: "TOK"},
    quoteToken: {address: "0xquote", name: "USDG", symbol: "USDG"},
    priceUsd,
    priceChange: change,
  };
}

function trade(id: string, at: string, priceUsd: number): Trade {
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

describe("chart fallback series", () => {
  it("places DexScreener buckets on their window, not invented OHLC", () => {
    const now = 1_700_000_000_000;
    const points = chartPointsFromPair(
      pair({h24: 100, h6: 50, h1: 25}),
      "0xtoken",
      {now, includeLive: false},
    );
    assert.equal(points.length, 3);
    assert.equal(points[0].t, now - 24 * 60 * 60 * 1000);
    assert.equal(points[0].price, 0.5);
    assert.equal(points[1].price, 1 / 1.5);
    assert.equal(points[2].price, 0.8);
  });

  it("returns no series when change buckets are missing", () => {
    assert.deepEqual(chartPointsFromPair(pair(undefined), "0xtoken"), []);
    assert.deepEqual(seriesFrom(pair(undefined), "0xtoken"), []);
  });

  it("draws a line from real fills when Gecko is empty", () => {
    const points = mergeTradesIntoChart(
      [],
      [
        trade("1", "2026-09-05T12:00:00.000Z", 0.01),
        trade("2", "2026-09-05T12:00:02.000Z", 0.012),
      ],
    );
    assert.equal(points.length, 2);
    assert.equal(points[0].price, 0.01);
    assert.equal(points[1].price, 0.012);
  });

  it("appends later fills onto bucket history", () => {
    const now = Date.parse("2026-09-05T12:00:00.000Z");
    const history = chartPointsFromPair(
      pair({h1: 0, m5: 0}),
      "0xtoken",
      {now, includeLive: false},
    );
    const points = mergeTradesIntoChart(
      history,
      [trade("3", "2026-09-05T12:00:05.000Z", 1.05)],
    );
    assert.ok(points.length >= 2);
    assert.equal(points[points.length - 1].price, 1.05);
  });
});
