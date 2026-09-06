import assert from "node:assert/strict";
import test from "node:test";

import {
  qualifiesForUniverse,
  paysHoldersInRwa,
  isProvenLaunchpadRwaPair,
  qualifiesAsNewListing,
} from "../src/lib/tokenUniverse.ts";
import {hasVolume24h} from "../src/lib/priceState.ts";
import {searchCategory, matchesSearchCategory} from "../src/lib/searchable.ts";

/**
 * Who belongs in the searchable universe.
 *
 * The rule is two independent arms: an RWA pair from Pons or Long, or paying
 * holders in RWA. These cover each arm on its own, and the cases that used to
 * fall through the gap between them.
 */

const pons = {id: "pons", name: "Pons", color: "#000", logoUrl: null, url: "#"};
const long = {id: "long", name: "Long", color: "#000", logoUrl: null, url: "#"};

const tok = (over: Record<string, unknown> = {}) =>
  ({
    kind: "token",
    id: "0xa",
    symbol: "AAA",
    name: "Triple A",
    launchpad: pons,
    rwaPaired: true,
    graduated: true,
    tradesOnUniswap: true,
    paysRwaRewards: false,
    rewardsToHolders: false,
    marketCapUsd: 100_000,
    volume24hUsd: 0,
    ...over,
  }) as never;

test("arm 1: an RWA pair from Pons qualifies", () => {
  assert.equal(qualifiesForUniverse(tok()), true);
  assert.equal(isProvenLaunchpadRwaPair(tok()), true);
});

test("arm 1: an RWA pair from Long qualifies", () => {
  assert.equal(qualifiesForUniverse(tok({launchpad: long})), true);
});

test("arm 1 requires a launchpad this app can prove", () => {
  // Previously any RWA-paired token counted, whoever launched it.
  const unknown = tok({launchpad: null});
  assert.equal(isProvenLaunchpadRwaPair(unknown), false);
  assert.equal(qualifiesForUniverse(unknown), false);
});

test("arm 1 still qualifies an unbonded Pons RWA pair — feeds hide it", () => {
  assert.equal(qualifiesForUniverse(tok({graduated: false})), true);
  assert.equal(isProvenLaunchpadRwaPair(tok({graduated: false})), true);
});

test("arm 2: ETH/USDG pair that pays an RWA, from Pons or Long", () => {
  const payer = tok({
    launchpad: pons,
    rwaPaired: false,
    pairedTicker: "USDG",
    graduated: true,
    paysRwaRewards: true,
  });
  assert.equal(paysHoldersInRwa(payer), true);
  assert.equal(qualifiesForUniverse(payer), true);
});

test("arm 2 requires a launchpad this app can prove", () => {
  const router = tok({
    launchpad: null,
    rwaPaired: false,
    pairedTicker: "USDG",
    paysRwaRewards: true,
  });
  assert.equal(qualifiesForUniverse(router), false);
});

test("a token meeting neither arm is excluded", () => {
  const neither = tok({
    launchpad: null,
    rwaPaired: false,
    paysRwaRewards: false,
    rewardsToHolders: false,
  });
  assert.equal(qualifiesForUniverse(neither), false);
});

test("a token meeting both arms is included once, not twice", () => {
  const both = tok({
    rwaPaired: true,
    paysRwaRewards: true,
    pairedTicker: "NVDA",
  });
  assert.equal(isProvenLaunchpadRwaPair(both), true);
  assert.equal(qualifiesForUniverse(both), true);
});

test("search still returns a token with no 24h volume", () => {
  const idle = tok({volume24hUsd: 0});
  const missing = tok({volume24hUsd: null});
  assert.equal(hasVolume24h(0), false);
  assert.equal(hasVolume24h(null), false);
  assert.equal(qualifiesForUniverse(idle), true);
  assert.equal(qualifiesForUniverse(missing), true);
});

test("the New tab is stricter than the universe", () => {
  const payer = tok({
    launchpad: pons,
    rwaPaired: false,
    pairedTicker: "USDG",
    paysRwaRewards: true,
    marketCapUsd: 1_000,
  });
  assert.equal(qualifiesForUniverse(payer), true);
  assert.equal(qualifiesAsNewListing(payer), false);

  // And a proven launch under the floor is not a listing either.
  assert.equal(qualifiesAsNewListing(tok({marketCapUsd: 49_999})), false);
  assert.equal(qualifiesAsNewListing(tok({marketCapUsd: 50_000})), true);
});

test("category queries are recognised", () => {
  assert.equal(searchCategory("pons"), "pons");
  assert.equal(searchCategory("  PONS "), "pons");
  assert.equal(searchCategory("long"), "long");
  assert.equal(searchCategory("rewards"), "rewards");
  assert.equal(searchCategory("rwa"), "rwa");
  assert.equal(searchCategory("hotdog"), null);
});

test("category membership follows the launchpad, not the name", () => {
  assert.equal(matchesSearchCategory(tok(), "pons"), true);
  assert.equal(matchesSearchCategory(tok(), "long"), false);
  assert.equal(matchesSearchCategory(tok({launchpad: long}), "long"), true);

  const payer = tok({
    launchpad: pons,
    rwaPaired: false,
    pairedTicker: "USDG",
    paysRwaRewards: true,
  });
  assert.equal(matchesSearchCategory(payer, "rewards"), true);
  assert.equal(matchesSearchCategory(payer, "pons"), true);
});

test("a token outside the universe is in no category", () => {
  const neither = tok({
    launchpad: null,
    rwaPaired: false,
    paysRwaRewards: false,
    rewardsToHolders: false,
  });
  assert.equal(matchesSearchCategory(neither, "rwa"), false);
});
