import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {chainSupportsAtomicBatch} from "../src/hooks/useTradeBatching";
import {HODL_ROUTER_V1, QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import {hodlCanExecuteQuote, liveTraderAllowed} from "../src/lib/liveTrade";

const WALLET = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";

describe("live trade flag", () => {
  it("stays off without flag, router, or a signed-in wallet", () => {
    assert.equal(
      liveTraderAllowed(WALLET, {flag: false, router: ROUTER, wallets: []}),
      false,
    );
    assert.equal(
      liveTraderAllowed(WALLET, {flag: true, router: "", wallets: []}),
      false,
    );
    assert.equal(
      liveTraderAllowed(null, {flag: true, router: ROUTER, wallets: []}),
      false,
    );
    assert.equal(
      liveTraderAllowed(WALLET, {
        flag: true,
        router: ROUTER,
        wallets: ["0x3333333333333333333333333333333333333333"],
      }),
      false,
    );
  });

  it("opens for every signed-in wallet when the allowlist is empty", () => {
    assert.equal(
      liveTraderAllowed(WALLET, {flag: true, router: ROUTER, wallets: []}),
      true,
    );
  });

  it("still restricts when an allowlist is set", () => {
    assert.equal(
      liveTraderAllowed(WALLET, {flag: true, router: ROUTER, wallets: [WALLET]}),
      true,
    );
  });

  it("sells a native-ETH V4 pool through Universal Router on v1: it can't receive PoolManager ETH", () => {
    const native = {
      venue: "v4" as const,
      quoteIsNative: true,
      quoteToken: "0x0000000000000000000000000000000000000000",
      pairToken: "0x0000000000000000000000000000000000000000",
      hops: [],
    };
    assert.equal(hodlCanExecuteQuote(native, "buy"), true);
    assert.equal(hodlCanExecuteQuote(native, "sell", HODL_ROUTER_V1), false);
    // v2 takes ETH from the PoolManager mid-trade, so the router sells it.
    assert.equal(hodlCanExecuteQuote(native, "sell", "0x2222222222222222222222222222222222222222"), true);
    assert.equal(hodlCanExecuteQuote({...native, venue: "v3"}, "sell", HODL_ROUTER_V1), true);
    assert.equal(
      hodlCanExecuteQuote({venue: "v4", quoteIsWeth: true, quoteToken: QUOTE_WETH}, "sell"),
      true,
    );
  });

  it("sends RWA-paired quotes through Universal Router, not HodlRouter", () => {
    assert.equal(hodlCanExecuteQuote(null), false);
    assert.equal(
      hodlCanExecuteQuote({quoteToken: QUOTE_USDG, quoteIsNative: false, quoteIsWeth: false}),
      true,
    );
    assert.equal(
      hodlCanExecuteQuote({quoteToken: QUOTE_WETH, quoteIsNative: false, quoteIsWeth: true}),
      true,
    );
    assert.equal(
      hodlCanExecuteQuote({quoteIsNative: true, quoteToken: "0x0000000000000000000000000000000000000000"}),
      true,
    );
    assert.equal(
      hodlCanExecuteQuote({
        quoteToken: "0x980dcf6766fa79f5cf0c4aadb3ab477ff15a9619",
        quoteIsNative: false,
        quoteIsWeth: false,
      }),
      false,
    );
    assert.equal(
      hodlCanExecuteQuote({
        quoteToken: QUOTE_WETH,
        quoteIsNative: false,
        quoteIsWeth: true,
        pairToken: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
        hops: [
          {
            venue: "v4",
            tokenIn: "0xfe7e19cbce2f896c6c528bc355baf5a768291e18",
            tokenOut: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
          },
          {
            venue: "v3",
            tokenIn: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
            tokenOut: QUOTE_WETH,
            v3Fee: 500,
          },
        ],
      }),
      false,
      "SPACEHOOD ETH exit is Universal Router, not Hodl",
    );
  });
});

describe("two-signature batching", () => {
  it("collapses to one signature only if 4663 reports atomic support", () => {
    assert.equal(chainSupportsAtomicBatch(null), false);
    assert.equal(chainSupportsAtomicBatch({}), false);
    assert.equal(
      chainSupportsAtomicBatch({"0x1237": {atomic: {status: "unsupported"}}}),
      false,
    );
    assert.equal(
      chainSupportsAtomicBatch({"0x1237": {atomic: {status: "supported"}}}),
      true,
    );
  });
});
