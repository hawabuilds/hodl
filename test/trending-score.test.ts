import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  TRENDING_MIN_LIQUIDITY_USD,
  TRENDING_MIN_MARKET_CAP_USD,
} from "../src/config/trending.ts";
import {
  compareTrendingMomentum,
  effectiveTrendingBounds,
  passesTrendingFloors,
  trendingMomentumScore,
} from "../src/lib/trendingScore.ts";
import type {TokenAsset} from "../src/lib/types.ts";

function windows(
  over: Partial<
    Record<
      "5m" | "1h" | "6h" | "24h",
      {volumeUsd: number; changePct?: number; buys?: number; sells?: number}
    >
  > = {},
): TokenAsset["windows"] {
  const base = {
    volumeUsd: 0,
    changePct: 0,
  };
  return {
    "5m": {...base, ...over["5m"]},
    "1h": {...base, ...over["1h"]},
    "6h": {...base, ...over["6h"]},
    "24h": {...base, ...over["24h"]},
  };
}

describe("trendingMomentumScore", () => {
  it("ranks a smaller cap with a volume surge above steady large-cap flow", () => {
    const surging = windows({
      "1h": {volumeUsd: 100_000, changePct: 12, buys: 48, sells: 40},
      "6h": {volumeUsd: 220_000},
      "24h": {volumeUsd: 200_000},
    });
    const steady = windows({
      "1h": {volumeUsd: 90_000, changePct: 0.5, buys: 30, sells: 28},
      "6h": {volumeUsd: 540_000},
      "24h": {volumeUsd: 2_000_000},
    });

    assert.ok(
      trendingMomentumScore(surging) > trendingMomentumScore(steady),
      "5× hourly surge should beat flat large-cap volume",
    );
  });

  it("downranks wash-like volume with very few swaps", () => {
    const organic = windows({
      "1h": {volumeUsd: 50_000, buys: 40, sells: 35},
      "24h": {volumeUsd: 400_000},
    });
    const wash = windows({
      "1h": {volumeUsd: 50_000, buys: 1, sells: 1},
      "24h": {volumeUsd: 400_000},
    });

    assert.ok(
      trendingMomentumScore(organic) > trendingMomentumScore(wash),
    );
  });
});

describe("trending floors", () => {
  it("applies default min mcap and liquidity when the user set no bounds", () => {
    const bounds = effectiveTrendingBounds({});
    assert.equal(bounds.minMarketCap, TRENDING_MIN_MARKET_CAP_USD);
    assert.equal(bounds.minLiquidity, TRENDING_MIN_LIQUIDITY_USD);
  });

  it("respects explicit user bounds over defaults", () => {
    const bounds = effectiveTrendingBounds({minMarketCap: 10_000});
    assert.equal(bounds.minMarketCap, 10_000);
    assert.equal(bounds.minLiquidity, TRENDING_MIN_LIQUIDITY_USD);
  });

  it("drops dust below trending floors", () => {
    assert.equal(
      passesTrendingFloors({
        marketCapUsd: 10_000,
        liquidityUsd: 20_000,
        tradeable: true,
      }),
      false,
    );
    assert.equal(
      passesTrendingFloors({
        marketCapUsd: 60_000,
        liquidityUsd: 6_000,
        tradeable: true,
      }),
      true,
    );
  });
});

describe("compareTrendingMomentum", () => {
  it("orders tokens by score descending", () => {
    const a = {
      windows: windows({
        "1h": {volumeUsd: 10_000, buys: 8, sells: 6},
        "24h": {volumeUsd: 80_000},
      }),
      volume24hUsd: 80_000,
    } as TokenAsset;
    const b = {
      windows: windows({
        "1h": {volumeUsd: 80_000, buys: 50, sells: 44},
        "24h": {volumeUsd: 200_000},
      }),
      volume24hUsd: 200_000,
    } as TokenAsset;

    const sorted = [a, b].sort(compareTrendingMomentum);
    assert.equal(sorted[0], b);
  });
});
