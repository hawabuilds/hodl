import assert from "node:assert/strict";
import test from "node:test";

import {
  qualifiesForUniverse,
  paysHoldersInRwa,
  isProvenLaunchpadRwaPair,
  qualifiesAsNewListing,
} from "../src/lib/tokenUniverse.ts";
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

test("arm 1 requires the pair to actually be trading", () => {
  assert.equal(qualifiesForUniverse(tok({graduated: false})), false);
  assert.equal(qualifiesForUniverse(tok({tradesOnUniswap: false})), false);
});

test("arm 2: paying holders in RWA qualifies on its own", () => {
  // No launchpad, not RWA-paired, not graduated, not on Uniswap — and it
  // still belongs, because it pays its holders. Every one of those used to
  // exclude it.
  const payer = tok({
    launchpad: null,
    rwaPaired: false,
    graduated: false,
    tradesOnUniswap: false,
    paysRwaRewards: true,
  });
  assert.equal(paysHoldersInRwa(payer), true);
  assert.equal(qualifiesForUniverse(payer), true);
});

test("arm 2 also accepts fee routing to holders", () => {
  const router = tok({
    launchpad: null,
    rwaPaired: false,
    graduated: false,
    tradesOnUniswap: false,
    rewardsToHolders: true,
  });
  assert.equal(qualifiesForUniverse(router), true);
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
  const both = tok({paysRwaRewards: true});
  assert.equal(paysHoldersInRwa(both), true);
  assert.equal(isProvenLaunchpadRwaPair(both), true);
  assert.equal(qualifiesForUniverse(both), true);
});

test("the New tab is stricter than the universe", () => {
  // A reward payer belongs in search but is not a new graduated listing.
  const payer = tok({launchpad: null, rwaPaired: false, paysRwaRewards: true});
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

  const payer = tok({launchpad: null, rwaPaired: false, paysRwaRewards: true});
  assert.equal(matchesSearchCategory(payer, "rewards"), true);
  assert.equal(matchesSearchCategory(payer, "pons"), false);
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
