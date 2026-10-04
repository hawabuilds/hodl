import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import type {SwapHop} from "../src/lib/swapRoute";
import {
  LIVE_BUY_MAX_USD,
  LIVE_BUY_OVER_CAP,
  liveBuyOverCap,
  quoteMissButtonLabel,
  quoteMissReason,
  refuseOverCapSell,
  refuseUnsafeBuyQuote,
  sellOutUsd,
} from "../src/lib/tradePolicy";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const PAIR = "0x2222222222222222222222222222222222222222" as const;
const ETH_USD = 2_500;

const usdg = (dollars: number) => BigInt(Math.round(dollars * 1e6));
const ethFor = (dollars: number) => BigInt(Math.round((dollars / ETH_USD) * 1e18));

function hop(tokenIn: `0x${string}`, tokenOut: `0x${string}`): SwapHop {
  return {venue: "v3", tokenIn, tokenOut, amountIn: "1", amountOut: "1", v3Fee: 3000} as SwapHop;
}

// HodlRouter quotes have no hops (single pool); Universal Router quotes have two.
const ROUTES: Array<[string, SwapHop[]]> = [
  ["HodlRouter (single hop)", []],
  ["Universal Router (multi-hop)", [hop(QUOTE_USDG, PAIR), hop(PAIR, TOKEN)]],
];

describe("trade cap: one limit, one message", () => {
  it("is $100, inclusive", () => {
    assert.equal(LIVE_BUY_MAX_USD, 100);
    assert.equal(liveBuyOverCap(100), false);
    assert.equal(liveBuyOverCap(100.01), true);
    assert.equal(liveBuyOverCap(Number.NaN), false);
  });

  it("reads the same on the ticket body and the button", () => {
    assert.equal(LIVE_BUY_OVER_CAP, "Max $100 per trade for now");
    assert.equal(quoteMissReason(LIVE_BUY_OVER_CAP), LIVE_BUY_OVER_CAP);
    assert.equal(quoteMissButtonLabel(LIVE_BUY_OVER_CAP), LIVE_BUY_OVER_CAP);
    // A response cached with the old wording maps to the new message.
    assert.equal(quoteMissReason("This size is above the current notional cap."), LIVE_BUY_OVER_CAP);
  });
});

describe("trade cap on buys", () => {
  for (const [route, hops] of ROUTES) {
    it(`${route}: over $100 is refused, $100 is allowed`, () => {
      const quote = {amountIn: usdg(150).toString(), amountOut: "1", hops};
      assert.equal(refuseUnsafeBuyQuote({quote, slippagePct: 1, amountUsd: 150}), LIVE_BUY_OVER_CAP);
      assert.equal(refuseUnsafeBuyQuote({quote, slippagePct: 1, amountUsd: 100}), null);
    });
  }
});

describe("trade cap on sells (payout before the fee, as HodlRouter checks it)", () => {
  for (const [route, hops] of ROUTES) {
    it(`${route}: USDG payout`, () => {
      const over = {amountOut: usdg(100.4).toString(), quoteToken: QUOTE_USDG, hops};
      const at = {amountOut: usdg(100).toString(), quoteToken: QUOTE_USDG, hops};
      assert.equal(refuseOverCapSell({quote: over, ethUsd: ETH_USD}), LIVE_BUY_OVER_CAP);
      assert.equal(refuseOverCapSell({quote: at, ethUsd: ETH_USD}), null);
    });

    it(`${route}: ETH and WETH payout, priced in USD`, () => {
      for (const quoteToken of [QUOTE_ETH, QUOTE_WETH]) {
        const over = {amountOut: ethFor(120).toString(), quoteToken, hops};
        const under = {amountOut: ethFor(80).toString(), quoteToken, hops};
        assert.equal(refuseOverCapSell({quote: over, ethUsd: ETH_USD}), LIVE_BUY_OVER_CAP);
        assert.equal(refuseOverCapSell({quote: under, ethUsd: ETH_USD}), null);
      }
    });
  }

  it("uses the gross payout: $100.40 out is over even though $99.90 lands after the fee", () => {
    assert.ok(Math.abs((sellOutUsd({amountOut: usdg(100.4), quoteToken: QUOTE_USDG, ethUsd: null}) ?? 0) - 100.4) < 1e-9);
    assert.equal(
      refuseOverCapSell({quote: {amountOut: usdg(100.4).toString(), quoteToken: QUOTE_USDG}, ethUsd: null}),
      LIVE_BUY_OVER_CAP,
    );
  });

  it("leaves the check to the server when ETH has no price yet", () => {
    assert.equal(sellOutUsd({amountOut: ethFor(500), quoteToken: QUOTE_ETH, ethUsd: null}), null);
    assert.equal(refuseOverCapSell({quote: {amountOut: ethFor(500).toString(), quoteToken: QUOTE_ETH}, ethUsd: null}), null);
  });
});

describe("quote API", () => {
  it("refuses a buy over $100 before any pool lookup or RPC call", async () => {
    const {GET} = await import("../src/app/api/quote/route");
    const res = await GET(new Request(`http://localhost/api/quote?token=${TOKEN}&side=buy&amountUsd=150`));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {error: LIVE_BUY_OVER_CAP});
  });
});
