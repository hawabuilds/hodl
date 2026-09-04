import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import {pickBestPool, type V3PoolHit} from "../src/lib/server/live/v3Pools";

describe("pickBestPool", () => {
  it("picks the highest-liquidity pool and keeps the rest", () => {
    const hits: V3PoolHit[] = [
      {
        token: "0xabc",
        pool: "0x1111111111111111111111111111111111111111",
        fee: 3000,
        quote: QUOTE_WETH,
        liquidity: 10n,
      },
      {
        token: "0xabc",
        pool: "0x2222222222222222222222222222222222222222",
        fee: 10000,
        quote: QUOTE_WETH,
        liquidity: 50n,
      },
      {
        token: "0xabc",
        pool: "0x3333333333333333333333333333333333333333",
        fee: 500,
        quote: QUOTE_USDG,
        liquidity: 0n,
      },
    ];
    const best = pickBestPool(hits);
    assert.equal(best?.pool, "0x2222222222222222222222222222222222222222");
    assert.equal(best?.fee, 10000);
    assert.equal(best?.others.length, 1);
    assert.equal(best?.others[0].pool, "0x1111111111111111111111111111111111111111");
  });

  it("returns null when every pool is empty", () => {
    assert.equal(
      pickBestPool([
        {
          token: "0xabc",
          pool: "0x1111111111111111111111111111111111111111",
          fee: 3000,
          quote: QUOTE_WETH,
          liquidity: 0n,
        },
      ]),
      null,
    );
  });
});
