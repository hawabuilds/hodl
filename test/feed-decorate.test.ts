import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {applyDexPair} from "../src/lib/server/live/feedDecorate";
import type {DexPair} from "../src/lib/server/live/dexscreener";
import type {TokenAsset} from "../src/lib/types";

function blankToken(): TokenAsset {
  return {
    kind: "token",
    id: "0xabc",
    address: "0xabc",
    symbol: "TEST",
    name: "Test",
    imageUrl: null,
    priceUsd: 0,
    changePct: 0,
    volume24hUsd: 0,
    marketCapUsd: 0,
    circulatingSupply: 1_000_000,
    liquidityUsd: 0,
    tradeable: null,
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
    listedAt: "2026-01-01T00:00:00.000Z",
    pairedTicker: "USDG",
    rwaPaired: false,
    buyTaxPct: null,
    sellTaxPct: null,
    feeSplit: null,
    launchpad: null,
    socials: {x: null, telegram: null, website: null, discord: null},
    description: "Test",
    series: [],
  };
}

function pair(over: Partial<DexPair> = {}): DexPair {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    pairAddress: "0xpair",
    baseToken: {address: "0xabc", name: "Test", symbol: "TEST"},
    quoteToken: {address: "0xquote", name: "USDG", symbol: "USDG"},
    priceUsd: "0.0042",
    liquidity: {usd: 80_000},
    volume: {m5: 100, h1: 400, h6: 900, h24: 12_000},
    priceChange: {m5: 0.1, h1: -0.5, h6: 1.2, h24: 8.5},
    marketCap: 999,
    info: {imageUrl: "https://img.example/test.png"},
    ...over,
  };
}

describe("home feed decorate", () => {
  it("fills the fields a cold home row reads from a DexScreener pair", () => {
    const decorated = applyDexPair(blankToken(), pair());
    assert.equal(decorated.priceUsd, 0.0042);
    assert.equal(decorated.changePct, 8.5);
    assert.equal(decorated.volume24hUsd, 12_000);
    assert.equal(decorated.imageUrl, null);
    assert.equal(decorated.marketCapUsd, 4200);
    assert.equal(decorated.windows["24h"].volumeUsd, 12_000);
    assert.equal(decorated.windows["1h"].changePct, -0.5);
  });

  it("keeps a store logo and does not invent a series when buckets are missing", () => {
    const held = applyDexPair(
      {...blankToken(), imageUrl: "https://store/logo.png"},
      pair({info: undefined, priceChange: undefined}),
    );
    assert.equal(held.imageUrl, "https://store/logo.png");
    assert.deepEqual(held.series, []);
  });

  it("never copies a Dex image onto the row — artwork is the stored column", () => {
    const stored = applyDexPair(
      {...blankToken(), imageUrl: "https://store/logo.png"},
      pair({info: {imageUrl: "https://dex.example/other.png"}}),
    );
    assert.equal(stored.imageUrl, "https://store/logo.png");
    const blank = applyDexPair(blankToken(), pair());
    assert.equal(blank.imageUrl, null);
  });

  it("does not clear stored socials when decorate applies a Dex pair", () => {
    const held = {
      x: "https://x.com/held",
      telegram: "https://t.me/held",
      website: "https://held.example",
      discord: "https://discord.gg/held",
    };
    const decorated = applyDexPair(
      {...blankToken(), socials: held},
      pair({
        info: {
          imageUrl: "https://dex.example/other.png",
          websites: [{url: "https://dex-site.example"}],
          socials: [{type: "twitter", url: "https://x.com/dex"}],
        },
      }),
    );
    assert.deepEqual(decorated.socials, held);
  });
});
