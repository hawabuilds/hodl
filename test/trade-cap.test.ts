import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import type {SwapHop} from "../src/lib/swapRoute";
import {
  LIVE_BUY_MAX_USD,
  LIVE_BUY_OVER_CAP,
  LIVE_CAP_USDG_RAW,
  liveBuyOverCap,
  quoteMissButtonLabel,
  quoteMissReason,
  refuseOverCapSell,
  refuseUnsafeBuyQuote,
  usdgRawOverCap,
} from "../src/lib/tradePolicy";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const PAIR = "0x2222222222222222222222222222222222222222" as const;

const usdg = (dollars: number) => BigInt(Math.round(dollars * 1e6));

function hop(tokenIn: `0x${string}`, tokenOut: `0x${string}`): SwapHop {
  return {venue: "v3", tokenIn, tokenOut, amountIn: "1", amountOut: "1", v3Fee: 3000} as SwapHop;
}

// HodlRouter quotes have no hops (single pool); Universal Router quotes have two.
const routes = (payToken: `0x${string}`): Array<[string, SwapHop[]]> => [
  ["HodlRouter (single hop)", []],
  ["Universal Router (multi-hop)", [hop(payToken, PAIR), hop(PAIR, TOKEN)]],
];

/** A stand-in for HodlRouter.quoteUsdg at a fixed ETH price. */
function routerAt(ethUsdg: bigint) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      readContract: (async (args: {functionName: string; args: readonly [bigint]}) => {
        calls.push(args.functionName);
        return (args.args[0] * ethUsdg) / 10n ** 18n;
      }) as never,
    },
  };
}

describe("trade cap: one limit, one message", () => {
  it("is $100, compared in raw USDG like HodlRouter", () => {
    assert.equal(LIVE_BUY_MAX_USD, 100);
    assert.equal(LIVE_CAP_USDG_RAW, 100_000_000n);
    assert.equal(usdgRawOverCap(100_000_000n), false);
    assert.equal(usdgRawOverCap(100_000_001n), true);
    assert.equal(liveBuyOverCap(100), false);
    assert.equal(liveBuyOverCap(100.01), true);
  });

  it("reads the same on the ticket body and the button", () => {
    assert.equal(LIVE_BUY_OVER_CAP, "Max $100 per trade for now");
    assert.equal(quoteMissReason(LIVE_BUY_OVER_CAP), LIVE_BUY_OVER_CAP);
    assert.equal(quoteMissButtonLabel(LIVE_BUY_OVER_CAP), LIVE_BUY_OVER_CAP);
    // A response cached with the old wording maps to the new message.
    assert.equal(quoteMissReason("This size is above the current notional cap."), LIVE_BUY_OVER_CAP);
  });
});

describe("trade cap on USDG buys (checked in the app, exactly)", () => {
  for (const [route, hops] of routes(QUOTE_USDG)) {
    it(`${route}: over $100 is refused, $100 is allowed`, () => {
      const quote = (raw: bigint) => ({amountIn: raw.toString(), amountOut: "1", hops, quoteToken: QUOTE_USDG});
      assert.equal(refuseUnsafeBuyQuote({quote: quote(usdg(100) + 1n), slippagePct: 1, amountUsd: 100}), LIVE_BUY_OVER_CAP);
      assert.equal(refuseUnsafeBuyQuote({quote: quote(usdg(100)), slippagePct: 1, amountUsd: 100}), null);
    });
  }

  it("ETH-paid buys are left to the router's price, not a spot dollar figure", () => {
    for (const [, hops] of routes(QUOTE_ETH)) {
      const quote = {amountIn: (10n ** 17n).toString(), amountOut: "1", hops, quoteToken: QUOTE_ETH};
      assert.equal(refuseUnsafeBuyQuote({quote, slippagePct: 1, amountUsd: 250}), null);
    }
  });
});

describe("trade cap on USDG sells (payout before the fee, as HodlRouter checks it)", () => {
  for (const [route, hops] of routes(QUOTE_USDG)) {
    it(`${route}: gross $100.40 is refused even though $99.90 lands after the fee`, () => {
      const quote = (raw: bigint) => ({amountOut: raw.toString(), quoteToken: QUOTE_USDG, hops});
      assert.equal(refuseOverCapSell({quote: quote(usdg(100.4))}), LIVE_BUY_OVER_CAP);
      assert.equal(refuseOverCapSell({quote: quote(usdg(100))}), null);
    });
  }

  it("ETH and WETH payouts are left to the quote API", () => {
    for (const quoteToken of [QUOTE_ETH, QUOTE_WETH]) {
      assert.equal(refuseOverCapSell({quote: {amountOut: (10n ** 18n).toString(), quoteToken}}), null);
    }
  });
});

describe("server check: ETH priced by HodlRouter.quoteUsdg", () => {
  it("asks the router, and agrees with it at the boundary", async () => {
    const {overTradeCap, tradeUsdgRaw} = await import("../src/lib/server/live/tradeCap");
    // Router TWAP says $2,000/ETH; spot says $2,600. 0.05 ETH is $100 to the
    // router, so it must pass even though spot would call it $130.
    const router = routerAt(2_000n * 10n ** 6n);
    const spot = async () => 2_600;
    const fiveHundredths = 5n * 10n ** 16n;
    assert.equal(await tradeUsdgRaw(QUOTE_ETH, fiveHundredths, router.client, spot), 100_000_000n);
    assert.equal(await overTradeCap(QUOTE_ETH, fiveHundredths, router.client, spot), false);
    assert.equal(await overTradeCap(QUOTE_WETH, fiveHundredths + 10n ** 12n, router.client, spot), true);
    assert.deepEqual(router.calls, ["quoteUsdg", "quoteUsdg", "quoteUsdg"]);
  });

  it("takes USDG as is and does not price other tokens", async () => {
    const {overTradeCap} = await import("../src/lib/server/live/tradeCap");
    const router = routerAt(2_000n * 10n ** 6n);
    assert.equal(await overTradeCap(QUOTE_USDG, usdg(100) + 1n, router.client), true);
    assert.equal(await overTradeCap(QUOTE_USDG, usdg(100), router.client), false);
    assert.equal(await overTradeCap(PAIR, 10n ** 30n, router.client), null);
    assert.equal(router.calls.length, 0);
  });

  it("falls back to spot only when the router can't answer", async () => {
    const {tradeUsdgRaw} = await import("../src/lib/server/live/tradeCap");
    const broken = {readContract: (async () => { throw new Error("no oracle"); }) as never};
    assert.equal(await tradeUsdgRaw(QUOTE_ETH, 10n ** 17n, broken, async () => 2_000), 200_000_000n);
    assert.equal(await tradeUsdgRaw(QUOTE_ETH, 10n ** 17n, broken, async () => null), null);
  });
});

describe("quote API", () => {
  it("refuses a USDG buy over $100 before any pool lookup or RPC call", async () => {
    const {GET} = await import("../src/app/api/quote/route");
    const res = await GET(new Request(`http://localhost/api/quote?token=${TOKEN}&side=buy&pay=usdg&amountUsd=150`));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {error: LIVE_BUY_OVER_CAP});
  });
});
