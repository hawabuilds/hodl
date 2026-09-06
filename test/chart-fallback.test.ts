import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {mergeTradesIntoChart} from "../src/lib/chartLive";
import {
  chartPointsFromPair,
  seriesFrom,
  type DexPair,
} from "../src/lib/server/live/dexscreener";
import {
  ENOUGH_TO_DRAW,
  pickResolvedCandles,
  realOhlcvCloses,
} from "../src/lib/server/live/geckoterminal";
import {deepestPoolForToken, tokenHasStockPair} from "../src/lib/server/live/market";
import {tokenChartFromFills} from "../src/lib/server/sources";
import {hasRealPool} from "../src/lib/server/live/universeStore";
import {timeframeLabel} from "../src/lib/types";
import type {ChartPoint, Trade} from "../src/lib/types";

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

  it("does not treat Dex change buckets as timeframe candles", () => {
    const buckets = chartPointsFromPair(
      pair({h24: 100, h6: 50, h1: 25, m5: 5}),
      "0xtoken",
      {now: 1_700_000_000_000, includeLive: true},
    );
    assert.ok(buckets.length >= 2);
    assert.deepEqual(tokenChartFromFills([]), []);
    const fills = tokenChartFromFills([
      trade("1", "2026-09-05T12:00:00.000Z", 0.01),
      trade("2", "2026-09-05T12:00:02.000Z", 0.012),
    ]);
    assert.equal(fills.length, 2);
    assert.equal(fills[0].price, 0.01);
    assert.notDeepEqual(fills, buckets);
  });
});

describe("resolved gecko timeframe", () => {
  function bars(n: number, price = 1): ChartPoint[] {
    return Array.from({length: n}, (_, i) => ({t: i * 1_000, price}));
  }

  it("keeps 1D when the daily series already has a line", () => {
    const picked = pickResolvedCandles("1D", {
      "1D": bars(ENOUGH_TO_DRAW, 2),
      "1h": bars(80, 1),
    });
    assert.equal(picked.resolvedTimeframe, "1D");
    assert.equal(picked.points.length, ENOUGH_TO_DRAW);
    assert.equal(timeframeLabel("1D", picked.resolvedTimeframe), "1D");
  });

  it("keeps a short daily line instead of filling with hourly candles", () => {
    const picked = pickResolvedCandles("1D", {
      "1D": bars(3, 2),
      "4h": bars(8, 1.5),
      "1h": bars(25, 1),
    });
    assert.equal(picked.resolvedTimeframe, "1D");
    assert.equal(picked.points.length, 3);
    assert.equal(timeframeLabel("1D", picked.resolvedTimeframe), "1D");
  });

  it("steps down to a finer bucket when 1D cannot form a line", () => {
    const picked = pickResolvedCandles("1D", {
      "1D": bars(1, 2),
      "1h": bars(25, 1),
    });
    assert.equal(picked.resolvedTimeframe, "1h");
    assert.equal(picked.points.length, 25);
    assert.equal(timeframeLabel("1D", picked.resolvedTimeframe), "1D · 1h");
  });

  it("stays empty when no ladder step can form a line", () => {
    const picked = pickResolvedCandles("1D", {
      "1D": bars(1, 2),
      "1h": bars(1, 1),
    });
    assert.equal(picked.resolvedTimeframe, "1D");
    assert.equal(picked.points.length, 0);
    assert.equal(timeframeLabel("1D", picked.resolvedTimeframe), "1D");
  });

  it("does not feed 1m candles to a 5m tab", () => {
    const picked = pickResolvedCandles("5m", {
      "5m": bars(1, 2),
      "1m": bars(12, 1),
    });
    assert.equal(picked.resolvedTimeframe, "5m");
    assert.equal(picked.points.length, 0);
  });

  it("drops zero-volume gecko buckets instead of carrying the last close", () => {
    const points = realOhlcvCloses([
      [1_800, 2, 2, 2, 2, 0],
      [1_200, 3, 3, 3, 3, 10],
      [600, 1, 1, 1, 1, 4],
    ]);
    assert.deepEqual(
      points.map((point) => point.price),
      [1, 3],
    );
  });

  it("keeps the close and drops a wei low instead of a floor wick", () => {
    const points = realOhlcvCloses([
      [1_200, 0.0012, 0.0014, 1.44e-15, 0.0013, 10],
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0].price, 0.0013);
    assert.equal(points[0].low, undefined);
    assert.equal(points[0].open, 0.0012);
  });
});

describe("deepest pool and junk clones", () => {
  it("picks the deepest USD-liq pool, not the stock pair", () => {
    const stock: DexPair = {
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: "0xstock",
      baseToken: {address: "0xtoken", name: "Tok", symbol: "TOK"},
      quoteToken: {
        address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
        name: "Apple",
        symbol: "AAPL",
      },
      priceUsd: "0.005726",
      liquidity: {usd: 8_000},
    };
    const usdg: DexPair = {
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: "0xusdg",
      baseToken: {address: "0xtoken", name: "Tok", symbol: "TOK"},
      quoteToken: {address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", name: "USDG", symbol: "USDG"},
      priceUsd: "0.006416",
      liquidity: {usd: 90_000},
    };
    const deepest = deepestPoolForToken("0xtoken", [stock, usdg]);
    assert.equal(deepest?.pairAddress, "0xusdg");
    assert.equal(tokenHasStockPair("0xtoken", [stock, usdg]), true);
  });

  it("drops stats-ranked rows with no real pool", () => {
    assert.equal(hasRealPool({pair_address: null, pool_address: null}), false);
    assert.equal(hasRealPool({pair_address: "0xpool", pool_address: null}), true);
    assert.equal(hasRealPool({pair_address: null, pool_address: "0xpool"}), true);
  });
});
