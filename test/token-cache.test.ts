import {describe, it, beforeEach} from "node:test";
import assert from "node:assert/strict";
import type {TokenAsset} from "../src/lib/types";
import {
  applyCachedToken,
  rememberTokens,
  resetTokenCacheForTests,
  tokenFor,
} from "../src/lib/tokenCache";

function token(over: Partial<TokenAsset> = {}): TokenAsset {
  return {
    kind: "token",
    id: "0xabc",
    address: "0xABC",
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
    ...over,
  };
}

describe("per-address token cache", () => {
  beforeEach(() => {
    resetTokenCacheForTests();
  });

  it("shares one row across Home and Search of the same address", () => {
    rememberTokens([
      token({
        id: "home",
        imageUrl: "https://cdn.example/a.webp",
        imageColor: "#00C805",
        volume24hUsd: 9,
      }),
    ]);
    const search = applyCachedToken(
      token({id: "search", address: "0xabc", imageUrl: null, volume24hUsd: 12}),
    );
    assert.equal(search.imageUrl, "https://cdn.example/a.webp");
    assert.equal(search.imageColor, "#00C805");
    assert.equal(search.volume24hUsd, 12);
    assert.equal(tokenFor("0xAbC")?.imageUrl, "https://cdn.example/a.webp");
  });

  it("a decorate miss cannot blank a stored image_url", () => {
    rememberTokens([token({imageUrl: "https://store/logo.png", priceUsd: 1})]);
    rememberTokens([token({imageUrl: null, priceUsd: 0.01})]);
    assert.equal(tokenFor("0xabc")?.imageUrl, "https://store/logo.png");
    assert.equal(tokenFor("0xabc")?.priceUsd, 0.01);
    const held = applyCachedToken(token({imageUrl: null}));
    assert.equal(held.imageUrl, "https://store/logo.png");
  });
});
