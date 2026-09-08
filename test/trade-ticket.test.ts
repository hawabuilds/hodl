import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import {price} from "../src/lib/format";
import {
  buyAvailableIsEth,
  buyMaxEntered,
  buyPaysNative,
  buyReceivePreview,
  platformFeeLabel,
  buyPreviewUsd,
  honestReceiveUsd,
  quoteOutSymbol,
  ticketReceivedSymbol,
  sellAmountInRaw,
  sellMaxEntered,
  sellPreviewUsd,
  ticketNetOut,
  ticketTakesHodlFee,
  tradeTokenAddress,
} from "../src/lib/tradeTicket";
import {
  IMPACT_BLOCK_BPS,
  IMPACT_WARN_BPS,
  PRICE_IMPACT_TOO_HIGH,
  buyImpactLevel,
  priceImpactBps,
  priceImpactLabel,
} from "../src/lib/tradePolicy";
import type {RwaAsset, TokenAsset} from "../src/lib/types";

const TOKEN: TokenAsset = {
  kind: "token",
  id: "0x1111111111111111111111111111111111111111",
  address: "0x1111111111111111111111111111111111111111",
  symbol: "PEPE",
  name: "Pepe",
  imageUrl: null,
  priceUsd: 0.01,
  changePct: 0,
  volume24hUsd: 0,
  marketCapUsd: 0,
  circulatingSupply: null,
  liquidityUsd: null,
  tradeable: true,
  rewards24hUsd: 0,
  rewardsToHolders: false,
  graduated: true,
  graduatedOnChain: true,
  tradesOnUniswap: true,
  paysRwaRewards: false,
  windows: {
    "5m": {volumeUsd: 0, changePct: 0},
    "1h": {volumeUsd: 0, changePct: 0},
    "6h": {volumeUsd: 0, changePct: 0},
    "24h": {volumeUsd: 0, changePct: 0},
  },
  holders: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  listedAt: null,
  pairedTicker: "WETH",
  rwaPaired: false,
  buyTaxPct: null,
  sellTaxPct: null,
  feeSplit: null,
  launchpad: null,
  socials: {x: null, telegram: null, website: null, discord: null},
  description: "",
  series: [],
};

const IBM: RwaAsset = {
  kind: "rwa",
  id: "ibm",
  ticker: "IBM",
  name: "IBM",
  logoUrl: null,
  contractAddress: "0x980dcf6766fa79f5cf0c4aadb3ab477ff15a9619",
  verified: true,
  stockType: "stock",
  sector: "software",
  description: "",
  priceUsd: 180,
  changePct: 0,
  volume24hUsd: 0,
  marketCapUsd: 0,
  circulatingSupply: null,
  series: [],
};

describe("trade token address", () => {
  it("reads the RWA contract and the launchpad token address", () => {
    assert.equal(tradeTokenAddress(TOKEN), TOKEN.address);
    assert.equal(tradeTokenAddress(IBM), IBM.contractAddress);
    assert.equal(tradeTokenAddress(null), null);
  });
});

describe("sell field is token units", () => {
  it("fills Max with held tokens, not dollars or ETH", () => {
    assert.equal(sellMaxEntered({heldUnits: 5000}), 5000);
    assert.equal(sellMaxEntered({heldUnits: 0}), 0);
    assert.notEqual(sellMaxEntered({heldUnits: 5000}), 50);
  });

  it("does not invent a sell size when the wallet holds 0", () => {
    assert.equal(
      sellAmountInRaw({
        amountTokens: 25,
        heldRaw: 0n,
        decimals: 18,
      }),
      undefined,
    );
    assert.equal(
      sellAmountInRaw({
        amountTokens: 1,
        heldRaw: 0n,
        decimals: 6,
      }),
      undefined,
    );
  });

  it("never requests more raw tokens than the on-chain balance", () => {
    const heldRaw = 10n ** 18n;
    assert.equal(
      sellAmountInRaw({
        amountTokens: 2,
        heldRaw,
        decimals: 18,
      }),
      heldRaw,
    );
  });

  it("sends the on-chain balance at 100% and a typed token amount otherwise", () => {
    const heldRaw = 10n ** 18n;
    assert.equal(
      sellAmountInRaw({
        amountTokens: 1,
        heldRaw,
        decimals: 18,
        sellAll: true,
      }),
      heldRaw,
    );
    assert.equal(
      sellAmountInRaw({
        amountTokens: 0.5,
        heldRaw,
        decimals: 18,
      }),
      heldRaw / 2n,
    );
    assert.equal(sellPreviewUsd({amountTokens: 1000, priceUsd: 0.02}), 20);
    assert.ok(Number.isNaN(sellPreviewUsd({amountTokens: 1000, priceUsd: null})));
  });

  it("does not invent ETH output when the route pays USDG", () => {
    assert.equal(
      quoteOutSymbol({
        quoteSymbol: "USDG",
        quoteIsNative: false,
        quoteIsWeth: false,
        quoteToken: QUOTE_USDG,
      }),
      "USDG",
    );
    assert.equal(
      quoteOutSymbol({
        quoteSymbol: "ETH",
        quoteIsNative: false,
        quoteIsWeth: true,
        quoteToken: QUOTE_WETH,
      }),
      "ETH",
    );
    assert.equal(
      quoteOutSymbol({
        quoteSymbol: "IBM",
        quoteIsNative: false,
        quoteIsWeth: false,
        quoteToken: IBM.contractAddress as `0x${string}`,
      }),
      "IBM",
    );
    assert.notEqual(
      quoteOutSymbol({
        quoteSymbol: "USDG",
        quoteIsNative: false,
        quoteIsWeth: false,
        quoteToken: QUOTE_USDG,
      }),
      "ETH",
    );
  });

  it("labels a native-quote buy as the token, not ETH, and prices the out not the spend", () => {
    const nativeBuy = {
      quoteSymbol: "ETH",
      quoteIsNative: true,
      quoteIsWeth: false,
      quoteToken: "0x0000000000000000000000000000000000000000" as const,
    };
    assert.equal(quoteOutSymbol(nativeBuy), "ETH");
    assert.equal(
      ticketReceivedSymbol({side: "buy", tokenSymbol: "PRIMED", quote: nativeBuy}),
      "PRIMED",
    );
    assert.equal(
      ticketReceivedSymbol({side: "sell", tokenSymbol: "PRIMED", quote: nativeBuy}),
      "ETH",
    );
    assert.equal(buyPreviewUsd({amountTokens: 1.64, priceUsd: 0.0004}), 0.000656);
    assert.notEqual(buyPreviewUsd({amountTokens: 1.64, priceUsd: 0.0004}), 100);
  });
});

describe("buy receive preview is Uniswap-style, not spend-as-receive", () => {
  it("shows dust USD and huge impact on a PRIMED-shaped $100 buy", () => {
    const preview = buyReceivePreview({
      amountTokens: 1.65,
      tokenSymbol: "PRIMED",
      markPriceUsd: 0.000394,
      spendUsd: 100,
      quotedUsdOut: 0.00065,
    });
    assert.equal(preview.youReceive, "You receive 1.6500 PRIMED");
    assert.equal(preview.receiveUsd, 0.00065);
    assert.notEqual(preview.receiveUsd, 100);
    assert.ok(preview.receiveUsd < 0.01);
    assert.equal(preview.receiveUsdLabel, `≈ ${price(0.00065)}`);
    assert.match(preview.receiveUsdLabel, /\$0\.00065/);
    assert.doesNotMatch(preview.receiveUsdLabel, /\$100/);
    assert.equal(preview.impactBps, 10000);
    assert.equal(preview.impactLabel, "Price impact 100.0%");
    assert.equal(preview.impactLevel, "block");
    assert.equal(PRICE_IMPACT_TOO_HIGH, "Price impact too high");
  });

  it("does not treat a high mark as the $100 spend", () => {
    assert.equal(honestReceiveUsd(80, 0.00065), 0.00065);
    assert.notEqual(honestReceiveUsd(80, 0.00065), 100);
    assert.equal(honestReceiveUsd(0.0004, null), 0.0004);
  });

  it("computes impact and levels from receive USD, not spend", () => {
    assert.equal(priceImpactBps(100, 100), 0);
    assert.equal(priceImpactBps(100, 85), 1500);
    assert.equal(priceImpactBps(100, 0.00065), 10000);
    assert.notEqual(priceImpactBps(100, 0.00065), 0);
    assert.equal(buyImpactLevel(500, 100, 95), "ok");
    assert.equal(buyImpactLevel(IMPACT_WARN_BPS, 100, 85), "warn");
    assert.equal(buyImpactLevel(IMPACT_BLOCK_BPS, 100, 50), "block");
    assert.equal(buyImpactLevel(100, 100, 0.00065), "block");
    assert.equal(priceImpactLabel(9980), "Price impact 99.8%");
  });
});

describe("platform fee label follows the execution path", () => {
  const spy = "0x117cc2133c37b721f49de2a7a74833232b3b4c0c" as const;
  const token = "0xf3239df6f081f7c98bc5ba27fb24eea66cd1d69c" as const;

  it("shows Platform fee 0.5% on a Hodl ETH/USDG single hop", () => {
    const hodlEth = platformFeeLabel({
      quoteToken: QUOTE_WETH,
      quoteIsNative: false,
      quoteIsWeth: true,
    });
    assert.equal(hodlEth.taken, true);
    assert.equal(hodlEth.bps, 50);
    assert.equal(hodlEth.title, "Platform fee 0.5%");
    assert.equal(hodlEth.note, null);

    const usdgQuote = {
      quoteToken: QUOTE_USDG,
      quoteIsNative: false,
      quoteIsWeth: false,
    };
    assert.equal(platformFeeLabel(usdgQuote).taken, true);
    assert.equal(ticketTakesHodlFee(usdgQuote), true);
  });

  it("shows Platform fee 0.5% on a Universal Router stock hop, same as Hodl", () => {
    const ur = {
      quoteToken: QUOTE_WETH,
      quoteIsNative: false,
      quoteIsWeth: true,
      pairToken: spy,
      hops: [
        {venue: "v4" as const, tokenIn: QUOTE_WETH, tokenOut: spy},
        {venue: "v4" as const, tokenIn: spy, tokenOut: token},
      ],
      feeBps: 50,
      feeAmount: "5",
      amountOut: "1000",
      netOut: "995",
    };
    const label = platformFeeLabel(ur);
    assert.equal(ticketTakesHodlFee(ur), false);
    assert.equal(label.taken, true);
    assert.equal(label.bps, 50);
    assert.equal(label.title, "Platform fee 0.5%");
    assert.equal(label.note, null);
    assert.equal(ticketNetOut(ur), 995n);
    assert.notEqual(label.title, "HODL fee 0.5%");
  });

  it("sizes buy Max from ETH, not $0 USDG, and shows ETH before a quote", () => {
    assert.equal(buyAvailableIsEth(null), true);
    assert.equal(
      buyPaysNative({
        quoteIsNative: false,
        quoteIsWeth: true,
        quoteToken: QUOTE_WETH,
        hops: [],
      }),
      true,
    );
    assert.equal(
      buyMaxEntered({
        paysNative: true,
        ethUnits: 0.05,
        ethUsd: 2500,
        currencyEth: false,
        spendUsd: 0,
      }),
      125,
    );
    assert.equal(
      buyMaxEntered({
        paysNative: true,
        ethUnits: 0.05,
        ethUsd: 2500,
        currencyEth: true,
        spendUsd: 0,
      }),
      0.05,
    );
  });
});
