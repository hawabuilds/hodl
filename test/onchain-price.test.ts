import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  ethUsdFromWethUsdgSqrt,
  tokenPriceInQuote,
  virtualReserves,
} from "../src/lib/server/live/onchainPrice.ts";
import {
  isMeasuredMcap,
  REQUIRE_MEASURED_MCAP_ON_NEW,
  showsOnNew,
} from "../src/lib/priceState.ts";

function sqrtX96FromRaw(rawCurrency1Per0: number): bigint {
  const sqrt = Math.sqrt(rawCurrency1Per0);
  return BigInt(Math.round(sqrt * 2 ** 96));
}

describe("sqrtPriceX96 → token price", () => {
  it("prices WETH (token0, 18) against USDG (token1, 6) as ETH/USD", () => {
    // 1 WETH = 2500 USDG. raw = 2500e6 / 1e18 = 2.5e-9
    const sqrt = sqrtX96FromRaw(2.5e-9);
    const price = tokenPriceInQuote(sqrt, true, 18, 6);
    assert.ok(Math.abs(price - 2500) / 2500 < 0.01, `got ${price}`);
    assert.ok(Math.abs(ethUsdFromWethUsdgSqrt(sqrt) - 2500) / 2500 < 0.01);
  });

  it("inverts when the memecoin is currency1", () => {
    // 1 token = 0.001 WETH. token is currency1, both 18 decimals.
    // raw = token_raw / WETH_raw = 1000
    const sqrt = sqrtX96FromRaw(1000);
    const price = tokenPriceInQuote(sqrt, false, 18, 18);
    assert.ok(Math.abs(price - 0.001) / 0.001 < 0.01, `got ${price}`);
  });

  it("returns 0 for an empty pool, never a fake zero market", () => {
    assert.equal(tokenPriceInQuote(0n, true, 18, 6), 0);
    assert.deepEqual(virtualReserves(0n, 1000n), {amount0: 0, amount1: 0});
    assert.deepEqual(virtualReserves(sqrtX96FromRaw(1), 0n), {amount0: 0, amount1: 0});
  });

  it("virtual reserves scale with liquidity", () => {
    const sqrt = sqrtX96FromRaw(1);
    const a = virtualReserves(sqrt, 1_000n);
    const b = virtualReserves(sqrt, 2_000n);
    assert.ok(a.amount0 > 0 && a.amount1 > 0);
    assert.ok(Math.abs(b.amount0 / a.amount0 - 2) < 0.02);
    assert.ok(Math.abs(b.amount1 / a.amount1 - 2) < 0.02);
  });
});

describe("measured market cap is never a null", () => {
  it("does not treat a missing cap as zero or as priced", () => {
    assert.equal(isMeasuredMcap(null), false);
    assert.equal(isMeasuredMcap({priced_at: null, last_mcap: null}), false);
    assert.equal(isMeasuredMcap({priced_at: null, last_mcap: 0}), false);
    assert.equal(isMeasuredMcap({priced_at: null, last_mcap: 12_000}), false);
    assert.equal(isMeasuredMcap({priced_at: "2026-09-04T00:00:00Z", last_mcap: null}), false);
    assert.equal(isMeasuredMcap({priced_at: "2026-09-04T00:00:00Z", last_mcap: 0}), false);
    assert.equal(isMeasuredMcap({priced_at: "2026-09-04T00:00:00Z", last_mcap: 12_000}), true);
  });

  it("keeps unevaluated rows on New until the gate is flipped", () => {
    assert.equal(REQUIRE_MEASURED_MCAP_ON_NEW, false);
    assert.equal(showsOnNew(null), true);
    assert.equal(showsOnNew({priced_at: null, last_mcap: null}), true);
    assert.equal(showsOnNew({price_status: "no_pool"}), false);
    assert.equal(showsOnNew({price_status: "failed"}), false);
    assert.equal(
      showsOnNew({priced_at: null, last_mcap: null}, {requireMeasured: true}),
      false,
    );
    assert.equal(
      showsOnNew(
        {priced_at: "2026-09-04T00:00:00Z", last_mcap: 1},
        {requireMeasured: true},
      ),
      true,
    );
  });
});
