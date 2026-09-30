import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {tokenHeaderPrice} from "../src/lib/chartHeader";
import {mergeTradesIntoChart} from "../src/lib/chartLive";
import type {ChartPoint, Trade} from "../src/lib/types";

const MIN = 60_000;
const T0 = Date.parse("2026-09-30T10:00:00Z");
const candles = (prices: number[]): ChartPoint[] =>
  prices.map((price, i) => ({t: T0 + i * MIN, price}));
const trade = (minutes: number, priceUsd: number): Trade =>
  ({id: `t${minutes}`, side: "buy", amount: 1, amountUsd: 10, priceUsd, maker: "0x", txHash: "0x", at: new Date(T0 + minutes * MIN).toISOString()}) as unknown as Trade;

/** The header and the line's last point, as the token page computes them. */
function headerAndLast(points: ChartPoint[], trades: Trade[], providerPrice: number) {
  const drawn = mergeTradesIntoChart(points, trades, MIN);
  return {
    header: tokenHeaderPrice({chartPoints: drawn, trades, providerPrice}),
    last: drawn[drawn.length - 1]?.price ?? null,
  };
}

describe("token header price", () => {
  it("is the chart's last point when a trade is newer than the candles", () => {
    const {header, last} = headerAndLast(candles([1, 1.1, 1.2]), [trade(5, 1.3)], 9);
    assert.equal(header, 1.3);
    assert.equal(header, last);
  });

  it("is the chart's last point when the candles are newer than the tape", () => {
    const {header, last} = headerAndLast(candles([1, 1.1, 1.2]), [trade(0, 1)], 9);
    assert.equal(header, 1.2);
    assert.equal(header, last);
  });

  it("never agrees with a provider price that disagrees with the chain", () => {
    // Insulinu: the pool last traded at $0.0000025829; a stored price said $0.00005632.
    const {header, last} = headerAndLast(candles([0.0000026, 0.0000025829]), [], 0.00005632);
    assert.equal(header, 0.0000025829);
    assert.equal(header, last);
  });

  it("matches the chart in every combination of candles and trades", () => {
    const cases: [number[], Trade[]][] = [
      [[2, 3], []],
      [[2, 3], [trade(1, 3.5)]],
      [[2, 3], [trade(9, 4), trade(8, 3.9)]],
      [[], [trade(3, 5)]],
      [[5], [trade(0, 5.5)]],
    ];
    for (const [prices, trades] of cases) {
      const {header, last} = headerAndLast(candles(prices), trades, 100);
      assert.equal(header, last, `candles ${prices} trades ${trades.map((t) => t.priceUsd)}`);
    }
  });

  it("falls back to the newest trade, then the provider, only when the chart is empty", () => {
    assert.equal(tokenHeaderPrice({chartPoints: [], trades: [trade(2, 7), trade(1, 6)], providerPrice: 9}), 7);
    assert.equal(tokenHeaderPrice({chartPoints: [], trades: [], providerPrice: 9}), 9);
    assert.equal(tokenHeaderPrice({chartPoints: [], trades: [], providerPrice: null}), null);
  });

  it("is what the token page puts in its header", () => {
    const page = readFileSync(join(process.cwd(), "src/components/AssetPage.tsx"), "utf8");
    assert.match(page, /tokenHeaderPrice\(\{\s*chartPoints: livePoints,/);
  });
});
