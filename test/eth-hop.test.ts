import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  ethPairHops,
  pickBestQuotedHop,
  type SwapHop,
} from "../src/lib/swapRoute";
import {FEE_COLLECTOR} from "../src/lib/contracts";
import {quotedPairOut} from "../src/lib/tradePolicy";
import {feeOnAmount, inputAfterBuyFee, PLATFORM_FEE_BPS} from "../src/lib/venueQuote";

const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
const AMZN = "0x12f190a9f9d7d37a250758b26824b97ce941bf54" as const;

describe("Uniswap quoter hop pick", () => {
  it("selects the quoter's best output, not an empty 5% V4", () => {
    const emptyV4 = {amountOut: 2491873877779n, label: "v4 fee=50000"};
    const liquidV3 = {amountOut: 97_000_000_000_000_000n, label: "v3 fee=100 via USDG"};
    const win = pickBestQuotedHop([emptyV4, liquidV3]);
    assert.equal(win?.label, "v3 fee=100 via USDG");
  });

  it("does not keep a dust hop when a better Uniswap candidate exists", () => {
    const dust = {amountOut: 1n, label: "empty v4 5%"};
    const better = {amountOut: 2n, label: "v3 weth"};
    assert.equal(pickBestQuotedHop([dust, better])?.label, "v3 weth");
    assert.equal(pickBestQuotedHop([better, dust])?.label, "v3 weth");
  });

  it("keeps a dust hop only when it is the sole Uniswap quote", () => {
    const dust = {amountOut: 1n, label: "v4 5%"};
    assert.equal(pickBestQuotedHop([dust])?.label, "v4 5%");
    assert.equal(pickBestQuotedHop([]), null);
    assert.equal(pickBestQuotedHop([{amountOut: 0n, label: "revert"}]), null);
  });
});

describe("ETH ↔ stock hops", () => {
  it("exposes the WETH → USDG → stock path Uniswap quoted", () => {
    const hop1: SwapHop = {
      venue: "v3",
      tokenIn: WETH,
      tokenOut: USDG,
      v3Fee: 100,
      amountIn: "10000000000000000",
    };
    const hop2: SwapHop = {
      venue: "v3",
      tokenIn: USDG,
      tokenOut: AMZN,
      v3Fee: 500,
      amountIn: "25000000",
    };
    const hops = ethPairHops({
      hop: hop1,
      hops: [hop1, hop2],
      amountOut: 97_000_000_000_000_000n,
    });
    assert.equal(hops.length, 2);
    assert.equal(hops[0].tokenOut, USDG);
    assert.equal(hops[1].tokenOut, AMZN);
    assert.deepEqual(ethPairHops({hop: hop1}), [hop1]);
  });

  it("skims 50 bps of a $25 ETH buy before Uniswap sees the rest", () => {
    const ethIn = 10_000_000_000_000_000n;
    assert.equal(PLATFORM_FEE_BPS, 50);
    assert.equal(feeOnAmount(ethIn), 50_000_000_000_000n);
    assert.equal(inputAfterBuyFee(ethIn), 9_950_000_000_000_000n);
    assert.equal(FEE_COLLECTOR, "0x1090d265749c1199919a754a8c2dd00150d1f0f9");
  });

  it("reads pair out from the last hop so a 3-leg buy still prices AMZN", () => {
    const hops: SwapHop[] = [
      {venue: "v3", tokenIn: WETH, tokenOut: USDG, v3Fee: 100, amountIn: "1"},
      {venue: "v3", tokenIn: USDG, tokenOut: AMZN, v3Fee: 500, amountIn: "25000000"},
      {
        venue: "v4",
        tokenIn: AMZN,
        tokenOut: "0x0c142d74e591b4b4ff7ddb9d600a75a3637a8179",
        amountIn: "97000000000000000",
      },
    ];
    assert.equal(quotedPairOut(hops), 97_000_000_000_000_000n);
  });
});
