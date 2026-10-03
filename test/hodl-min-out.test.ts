import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {HODL_ROUTER_V1} from "../src/lib/contracts";
import {amountOutMinimum, hodlRouterMinOut} from "../src/lib/tradePolicy";

const V2 = "0x2e234dae75c793f67a35089c9d99245e1c58470b";
// Sell quote: 1.0 ETH gross out of the swap, 0.995 ETH after the 0.5% fee.
const GROSS = 10n ** 18n;
const NET = GROSS - (GROSS * 50n) / 10_000n;

describe("hodlRouterMinOut", () => {
  it("v2 sell: minimum is slippage off the after-fee amount", () => {
    const min = hodlRouterMinOut({router: V2, side: "sell", amountOut: GROSS, netOut: NET, slippagePct: 1});
    assert.equal(min, amountOutMinimum(NET, 1));
    assert.equal(min, 985_050_000_000_000_000n);
  });

  it("v2 sell keeps the full slippage tolerance the user chose", () => {
    // Price falls 0.9% (inside 1% slippage): seller receives 0.991 * 0.995 ETH.
    const received = (GROSS * 991n) / 1000n - ((GROSS * 991n) / 1000n * 50n) / 10_000n;
    const v2Min = hodlRouterMinOut({router: V2, side: "sell", amountOut: GROSS, netOut: NET, slippagePct: 1});
    assert.ok(received >= v2Min, "v2 minimum must allow a 0.9% move at 1% slippage");
    // The old gross-based minimum would have reverted the same trade on v2.
    assert.ok(received < amountOutMinimum(GROSS, 1));
  });

  it("v1 sell: unchanged, minimum is slippage off the gross output", () => {
    const min = hodlRouterMinOut({
      router: HODL_ROUTER_V1,
      side: "sell",
      amountOut: GROSS,
      netOut: NET,
      slippagePct: 1,
    });
    assert.equal(min, amountOutMinimum(GROSS, 1));
  });

  it("matches the v1 address in any letter case", () => {
    const min = hodlRouterMinOut({
      router: HODL_ROUTER_V1.toUpperCase().replace("0X", "0x"),
      side: "sell",
      amountOut: GROSS,
      netOut: NET,
      slippagePct: 1,
    });
    assert.equal(min, amountOutMinimum(GROSS, 1));
  });

  it("v2 sell with no netOut in the quote still subtracts the fee", () => {
    // swapQuote falls back to netOut = amountOut when the API omits it.
    const min = hodlRouterMinOut({router: V2, side: "sell", amountOut: GROSS, netOut: GROSS, slippagePct: 1});
    assert.equal(min, amountOutMinimum(NET, 1));
  });

  it("v2 sell never uses a netOut above the after-fee amount, but honours a lower one", () => {
    const lower = NET - 1000n;
    assert.equal(
      hodlRouterMinOut({router: V2, side: "sell", amountOut: GROSS, netOut: lower, slippagePct: 1}),
      amountOutMinimum(lower, 1),
    );
    assert.equal(
      hodlRouterMinOut({router: V2, side: "sell", amountOut: GROSS, netOut: 0n, slippagePct: 1}),
      amountOutMinimum(NET, 1),
    );
  });

  it("buys use netOut on both routers", () => {
    for (const router of [V2, HODL_ROUTER_V1]) {
      assert.equal(
        hodlRouterMinOut({router, side: "buy", amountOut: 5_000n, netOut: 4_000n, slippagePct: 2}),
        amountOutMinimum(4_000n, 2),
      );
    }
  });
});
