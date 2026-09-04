import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import {
  applyBps,
  dustGuardRaw,
  humanToRaw,
  quoteTokenDecimals,
  usdgRawFromUsd,
  USDG_DECIMALS,
  WETH_DECIMALS,
} from "../src/lib/quoteAmounts";

describe("quote amounts use the token's real decimals", () => {
  it("USDG is 6 decimals, WETH is 18", () => {
    assert.equal(quoteTokenDecimals(QUOTE_USDG), 6);
    assert.equal(quoteTokenDecimals(QUOTE_WETH), 18);
    assert.notEqual(USDG_DECIMALS, WETH_DECIMALS);
  });

  it("$1 USDG dust is 1e6, not 1e18", () => {
    assert.equal(usdgRawFromUsd(1), 1_000_000n);
    assert.equal(dustGuardRaw(QUOTE_USDG, 1), 1_000_000n);
    assert.notEqual(dustGuardRaw(QUOTE_USDG, 1), 10n ** 18n);
    assert.notEqual(humanToRaw(1, quoteTokenDecimals(QUOTE_USDG)), 10n ** 18n);
  });

  it("a 50 bps fee on $1 of USDG is 5_000 raw, not 5e15", () => {
    const oneDollar = dustGuardRaw(QUOTE_USDG, 1);
    const fee = applyBps(oneDollar, 50);
    assert.equal(fee, 5_000n);
    assert.notEqual(fee, 5n * 10n ** 15n);
  });

  it("refuses to treat 1e18 WETH as one dollar", () => {
    assert.throws(() => dustGuardRaw(QUOTE_WETH, 1), /ETH\/USD price/);
  });
});
