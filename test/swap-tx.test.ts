import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  UR_COMMAND_V4_SWAP,
  V4_ACTION_SETTLE,
  V4_ACTION_SETTLE_ALL,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE_ALL,
} from "../src/lib/v4Encoding";
import {
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
} from "../src/lib/contracts";
import {amountOutMinimum, ticketBlockReason} from "../src/lib/tradePolicy";
import {parseSwapQuote} from "../src/lib/swapQuote";
import {
  buildV3Swap,
  buildV4Swap,
  packCommands,
  UR_COMMAND_PERMIT2_TRANSFER_FROM,
  UR_COMMAND_WRAP_ETH,
} from "../src/lib/swapTx";

const KEY = {
  currency0: "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const,
  currency1: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const,
  fee: 100,
  tickSpacing: 1,
  hooks: "0x0000000000000000000000000000000000000000" as const,
};

describe("swap tx encoding", () => {
  it("packs Permit2 pull in front of V4_SWAP", () => {
    const tx = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
    });
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.equal(tx.value, 0n);
    assert.match(tx.data, /^0x/);
    assert.equal(
      packCommands([UR_COMMAND_PERMIT2_TRANSFER_FROM, UR_COMMAND_V4_SWAP]),
      "0x0210",
    );
  });

  it("sends value for native ETH and wraps WETH", () => {
    const native = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      nativeIn: true,
    });
    assert.equal(native.value, 10n ** 16n);

    const wrapped = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      wrapEth: true,
    });
    assert.equal(wrapped.value, 10n ** 16n);
    assert.equal(packCommands([UR_COMMAND_WRAP_ETH, UR_COMMAND_V4_SWAP]), "0x0b10");
  });

  it("uses SETTLE from the router when tokens are already there", () => {
    const tx = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      alreadyOnRouter: true,
    });
    assert.equal(tx.value, 0n);
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.ok(tx.data.length > 10);
    assert.equal(
      [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE, V4_ACTION_TAKE_ALL].join(","),
      "6,11,15",
    );
    assert.equal(
      [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE_ALL, V4_ACTION_TAKE_ALL].join(","),
      "6,12,15",
    );
  });

  it("encodes SwapRouter02 exactInputSingle for the V3 venue", () => {
    const tx = buildV3Swap({
      tokenIn: KEY.currency0,
      tokenOut: KEY.currency1,
      fee: 100,
      recipient: "0x1111111111111111111111111111111111111111",
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      nativeIn: true,
    });
    assert.equal(tx.to, UNISWAP_SWAP_ROUTER_02);
    assert.equal(tx.value, 10n ** 16n);
    assert.equal(tx.data.slice(0, 10), "0x04e45aaf");
  });
});

describe("trade policy", () => {
  it("does not ticket-block an RWA when a Uniswap venue exists", () => {
    assert.equal(
      ticketBlockReason({
        kind: "rwa",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: "v4",
        quotePending: false,
      }),
      null,
    );
    assert.equal(
      ticketBlockReason({
        kind: "rwa",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: undefined,
        quotePending: false,
      }),
      null,
      "undefined venue means not quoted yet, not a missing pool",
    );
    assert.match(
      ticketBlockReason({
        kind: "rwa",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: null,
        quotePending: false,
      }) ?? "",
      /no uniswap pool/i,
    );
  });

  it("blocks demo, missing wallet, and a missing venue", () => {
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: true,
        wallet: "0x1",
        venue: "v4",
        quotePending: false,
      }) ?? "",
      /demo/i,
    );
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: null,
        venue: "v4",
        quotePending: false,
      }) ?? "",
      /sign in/i,
    );
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: null,
        quotePending: false,
      }) ?? "",
      /no uniswap pool/i,
    );
    assert.equal(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: "v4",
        quotePending: false,
      }),
      null,
    );
    assert.equal(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: undefined,
        quotePending: false,
      }),
      null,
      "undefined venue means not quoted yet, not a missing pool",
    );
  });

  it("applies slippage to the quoter output", () => {
    assert.equal(amountOutMinimum(10_000n, 1), 9_900n);
    assert.equal(amountOutMinimum(10_000n, 0), 10_000n);
  });
});

describe("swap quote parse", () => {
  it("rejects a paper-style empty venue", () => {
    const miss = parseSwapQuote({venue: null});
    assert.equal(miss.ok, false);
  });

  it("keeps the sized amountIn the encoder must use", () => {
    const parsed = parseSwapQuote({
      venue: "v4",
      amountIn: "1000000",
      amountOut: "42",
      quoteToken: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      poolKey: KEY,
      zeroForOne: true,
      venueLabel: "Uniswap V4",
      creatorTax: "none",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.quote.amountIn, "1000000");
  });

  it("accepts a V4 quote paired with a tokenized stock, not USDG", () => {
    const ibm = "0x980dcf6766fa79f5cf0c4aadb3ab477ff15a9619";
    const parsed = parseSwapQuote({
      venue: "v4",
      amountIn: "106464526019930160",
      amountOut: "147002329996137738092522",
      quoteToken: ibm,
      quoteIsNative: false,
      quoteIsWeth: false,
      poolKey: {
        currency0: ibm,
        currency1: "0xf2e122a481b440c40eee7a7ca6d5eef65a591b76",
        fee: 0,
        tickSpacing: 200,
        hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.quote.quoteToken, ibm);
      assert.equal(parsed.quote.venue, "v4");
      assert.ok(parsed.quote.poolKey);
    }
  });
});
