import {describe, it, beforeEach} from "node:test";
import assert from "node:assert/strict";
import type {TokenAsset} from "../src/lib/types";
import {
  applyCachedLogo,
  loadedLogoFor,
  rememberLoadedLogo,
  rememberTokenLogos,
  resetTokenLogoCacheForTests,
} from "../src/lib/tokenLogoCache";

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

describe("token logo cache", () => {
  beforeEach(() => {
    resetTokenLogoCacheForTests();
  });

  it("keys by address and does not let a later miss wipe a known URL", () => {
    rememberTokenLogos([
      token({imageUrl: "https://cdn.example/a.png", imageColor: "#111"}),
    ]);
    rememberTokenLogos([token({imageUrl: null, imageColor: null})]);
    const held = applyCachedLogo(token({imageUrl: null}));
    assert.equal(held.imageUrl, "https://cdn.example/a.png");
    assert.equal(held.imageColor, "#111");
  });

  it("reuses one entry across views of the same address", () => {
    rememberTokenLogos([
      token({
        id: "feed-row",
        address: "0xAbC",
        imageUrl: "https://cdn.example/a.png",
      }),
    ]);
    const page = applyCachedLogo(
      token({id: "chart-page", address: "0xabc", imageUrl: null}),
    );
    assert.equal(page.imageUrl, "https://cdn.example/a.png");
  });

  it("never drops a session-decoded logo after a decorate miss", () => {
    rememberLoadedLogo("0xabc", "https://cdn.example/decoded.png");
    assert.equal(loadedLogoFor("0xABC"), "https://cdn.example/decoded.png");
    const afterMiss = applyCachedLogo(token({imageUrl: null}));
    assert.equal(afterMiss.imageUrl, "https://cdn.example/decoded.png");
  });
});
