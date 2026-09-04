import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  LONG_DOPPLER_HOOK,
  LONG_V4_FEE,
  LONG_V4_TICK_SPACING,
  PONS_V4_FEE,
  PONS_V4_HOOK,
  PONS_V4_TICK_SPACING,
  QUOTE_WETH,
} from "../src/lib/contracts";
import {ethQuoteAlternates, NATIVE_ETH} from "../src/lib/server/live/v4Pools";

describe("V4 PoolKey constraints", () => {
  it("locks Pons fee 0 / tick 200 / hook", () => {
    assert.equal(PONS_V4_FEE, 0);
    assert.equal(PONS_V4_TICK_SPACING, 200);
    assert.equal(PONS_V4_HOOK, "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044");
  });

  it("locks Long fee 0x800000 / tick 8 / Doppler hook", () => {
    assert.equal(LONG_V4_FEE, 0x800000);
    assert.equal(LONG_V4_TICK_SPACING, 8);
    assert.equal(LONG_DOPPLER_HOOK, "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544");
  });

  it("tries native ETH and WETH as distinct quotes", () => {
    const both = ethQuoteAlternates(NATIVE_ETH);
    assert.deepEqual(both, [NATIVE_ETH, QUOTE_WETH]);
    assert.deepEqual(ethQuoteAlternates(QUOTE_WETH), [NATIVE_ETH, QUOTE_WETH]);
    const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
    assert.deepEqual(ethQuoteAlternates(usdg), [usdg]);
  });
});
