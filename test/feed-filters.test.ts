import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  NO_FILTERS,
  passesFilters,
  type FeedFilterState,
} from "../src/lib/feedFilters.ts";
import type {TokenAsset} from "../src/lib/types.ts";

function token(over: Partial<TokenAsset> = {}): TokenAsset {
  return {
    kind: "token",
    id: "0xabc",
    address: "0xabc",
    symbol: "TEST",
    name: "Test",
    imageUrl: null,
    priceUsd: null,
    changePct: 0,
    volume24hUsd: null,
    marketCapUsd: null,
    circulatingSupply: null,
    liquidityUsd: null,
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

const minCap: FeedFilterState = {...NO_FILTERS, minMarketCap: 50_000};
const minLiq: FeedFilterState = {...NO_FILTERS, minLiquidity: 5_000};

describe("passesFilters explicit bounds", () => {
  it("never lets a null market cap through a minimum", () => {
    assert.equal(passesFilters(token({marketCapUsd: null}), minCap), false);
    assert.equal(passesFilters(token({marketCapUsd: 12_000}), minCap), false);
    assert.equal(passesFilters(token({marketCapUsd: 50_000}), minCap), true);
    assert.equal(
      passesFilters(token({priceUsd: null, marketCapUsd: null}), minCap),
      false,
    );
  });

  it("never lets a null liquidity through a minimum", () => {
    assert.equal(passesFilters(token({liquidityUsd: null}), minLiq), false);
    assert.equal(
      passesFilters(token({liquidityUsd: null, tradeable: null}), minLiq),
      false,
    );
    assert.equal(passesFilters(token({liquidityUsd: 4_999}), minLiq), false);
    assert.equal(passesFilters(token({liquidityUsd: 5_000}), minLiq), true);
  });

  it("excludes null volume and age when those bounds are set", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    assert.equal(
      passesFilters(token(), {...NO_FILTERS, minVolume: 100}, now),
      false,
    );
    assert.equal(
      passesFilters(
        token({volume24hUsd: 250}),
        {...NO_FILTERS, minVolume: 100},
        now,
      ),
      true,
    );
    assert.equal(
      passesFilters(token({createdAt: "2026-01-01T23:00:00.000Z"}), {
        ...NO_FILTERS,
        minAgeHours: 3,
      }, now),
      false,
    );
    assert.equal(
      passesFilters(token({createdAt: "2026-01-01T12:00:00.000Z"}), {
        ...NO_FILTERS,
        minAgeHours: 3,
      }, now),
      true,
    );
    assert.equal(
      passesFilters(token({createdAt: ""}), {...NO_FILTERS, minAgeHours: 3}, now),
      false,
    );
  });

  it("keeps unpriced rows when no bound is set", () => {
    assert.equal(passesFilters(token(), NO_FILTERS), true);
  });
});
