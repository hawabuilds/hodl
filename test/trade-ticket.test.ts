import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";
import {
  buyAvailableIsEth,
  buyMaxEntered,
  buyPaysNative,
  platformFeeLabel,
  quoteOutSymbol,
  sellAmountInRaw,
  sellMaxEntered,
  ticketNetOut,
  ticketTakesHodlFee,
  tradeTokenAddress,
} from "../src/lib/tradeTicket";
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

describe("sell 100% uses the real balance mark", () => {
  it("fills USD with balance × price, not token units", () => {
    assert.equal(sellMaxEntered({heldUsd: 50, currencyEth: false, ethUsd: 2500}), 50);
    assert.equal(sellMaxEntered({heldUsd: 50, currencyEth: true, ethUsd: 2500}), 0.02);
    assert.notEqual(sellMaxEntered({heldUsd: 50, currencyEth: false, ethUsd: 2500}), 5000);
  });

  it("sends the on-chain balance at 100%", () => {
    const heldRaw = 10n ** 18n;
    assert.equal(
      sellAmountInRaw({
        amountUsd: 50,
        heldUsd: 50,
        heldRaw,
        priceUsd: 0.01,
        decimals: 18,
      }),
      heldRaw,
    );
    assert.equal(
      sellAmountInRaw({
        amountUsd: 25,
        heldUsd: 50,
        heldRaw,
        priceUsd: 0.01,
        decimals: 18,
      }),
      heldRaw / 2n,
    );
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

  it("shows Platform fee 0% on a Universal Router multi-hop, even if feeBps is 50", () => {
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
      amountOut: "1000",
      netOut: "995",
    };
    const label = platformFeeLabel(ur);
    assert.equal(ticketTakesHodlFee(ur), false);
    assert.equal(label.taken, false);
    assert.equal(label.bps, 0);
    assert.equal(label.title, "Platform fee 0%");
    assert.equal(label.note, "No platform fee on this route");
    assert.equal(ticketNetOut(ur), 1000n);
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
