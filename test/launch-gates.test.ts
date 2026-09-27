import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {
  draftQualifies,
  launchBlockReason,
  launchSignatureCount,
  type LaunchDraft,
  type PairOption,
} from "../src/lib/launch/launchForm";
import {qualifiesForUniverse} from "../src/lib/universe";
import {
  FAKE_LONG_EXAMPLE,
  hasCloneLongVanity,
  isLongAppMetadata,
  longAuthenticityFromSignals,
} from "../src/lib/longAuthenticity";

/**
 * The form and the eligibility gate must never disagree.
 *
 * A launch that passes the form and fails `qualifiesForUniverse()` is the
 * worst outcome this feature has: the transaction succeeds, the creator pays,
 * and the token is invisible in the app that launched it. These tests pin the
 * two together so a later edit to either one breaks here instead of there.
 */

const RWA: PairOption = {
  address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
  label: "AAPL",
  quoteKind: "rwa",
  isRwa: true,
};
const WETH: PairOption = {
  address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  label: "ETH",
  quoteKind: "eth",
  isRwa: false,
};
const USDG: PairOption = {
  address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  label: "USDG",
  quoteKind: "usdg",
  isRwa: false,
};

function draft(over: Partial<LaunchDraft> = {}): LaunchDraft {
  return {
    launchpad: "pons",
    name: "Test Token",
    symbol: "TEST",
    logo: "https://example.supabase.co/storage/v1/object/public/token-images/a.webp",
    description: "",
    pair: RWA,
    rewardRwa: null,
    creatorTaxBps: 100,
    devBuy: "",
    socials: {},
    ...over,
  };
}

describe("launch form vs the eligibility gate", () => {
  it("accepts a stock-paired launch", () => {
    assert.equal(launchBlockReason(draft()), null);
    assert.equal(draftQualifies(draft()), true);
  });

  it("refuses an ETH pair with no holder reward, instead of launching a ghost", () => {
    const d = draft({pair: WETH, rewardRwa: null});
    assert.equal(draftQualifies(d), false);
    const reason = launchBlockReason(d);
    assert.ok(reason, "an ineligible draft must be blocked");
    assert.match(reason, /never appear in hodl/);
  });

  it("accepts an ETH or USDG pair once holders are paid in a stock", () => {
    for (const pair of [WETH, USDG]) {
      const d = draft({pair, rewardRwa: "AAPL"});
      assert.equal(draftQualifies(d), true, pair.label);
      assert.equal(launchBlockReason(d), null, pair.label);
    }
  });

  it("never lets the form pass a draft the real gate would reject", () => {
    const combos: LaunchDraft[] = [];
    for (const pair of [RWA, WETH, USDG]) {
      for (const rewardRwa of [null, "AAPL"]) {
        for (const launchpad of ["pons", "long"] as const) {
          combos.push(draft({pair, rewardRwa, launchpad}));
        }
      }
    }
    for (const d of combos) {
      if (launchBlockReason(d) !== null) continue;
      assert.equal(
        qualifiesForUniverse({
          launchpad: d.launchpad,
          quoteKind: d.pair!.quoteKind,
          rewardRwa: d.rewardRwa,
          bonded: false,
        }),
        true,
        `form allowed a draft the gate rejects: ${d.pair!.label}/${d.rewardRwa}`,
      );
    }
  });
});

describe("launch form basics", () => {
  it("asks for the things Pons will not accept empty", () => {
    assert.match(launchBlockReason(draft({name: ""}))!, /name/i);
    assert.match(launchBlockReason(draft({symbol: ""}))!, /ticker/i);
    assert.match(launchBlockReason(draft({logo: ""}))!, /picture/i);
    assert.match(launchBlockReason(draft({pair: null}))!, /trades against/i);
  });

  it("rejects a ticker with punctuation in it", () => {
    assert.match(launchBlockReason(draft({symbol: "A B"}))!, /letters and numbers/i);
  });

  it("holds the creator fee inside the factory's range", () => {
    assert.equal(launchBlockReason(draft({creatorTaxBps: 0})), null);
    assert.match(launchBlockReason(draft({creatorTaxBps: 5000}))!, /Creator fee/);
    assert.match(launchBlockReason(draft({creatorTaxBps: -1}))!, /Creator fee/);
  });

  it("counts a dev buy as a second signature, because Pons cannot bundle it", () => {
    assert.equal(launchSignatureCount(draft()), 1);
    assert.equal(launchSignatureCount(draft({devBuy: "0.5"})), 2);
    assert.equal(launchSignatureCount(draft({devBuy: "0"})), 1);
  });

  it("rejects a dev buy that is not a number", () => {
    assert.match(launchBlockReason(draft({devBuy: "abc"}))!, /not an amount/);
  });
});

describe("Long provenance, not imitation", () => {
  /**
   * hodl launches through the real Airlock but is not app.long.xyz, so its
   * tokens legitimately lack that app's URI fields. The fix is provenance —
   * hodl knows what it launched. These tests hold the line that we do not
   * instead forge the other app's signature.
   */
  it("still rejects a generic Doppler clone's metadata", () => {
    assert.equal(
      isLongAppMetadata({
        name: "x",
        description: "y",
        image_hash: "z",
        social_links: [],
      }),
      false,
    );
  });

  it("still rejects hodl's own metadata shape, which makes no app.long.xyz claim", () => {
    // Our document states what is true and names us as the launcher. It must
    // not accidentally satisfy a check that means "app.long.xyz made this".
    assert.equal(
      isLongAppMetadata({
        name: "Test Token",
        symbol: "TEST",
        image: "ipfs://…",
        attributes: [{trait_type: "launch_provider", value: "hodl"}],
        initial_deployer: {address: "0x0000000000000000000000000000000000000001"},
      }),
      false,
    );
  });

  it("still fast-rejects the clone factory's mined vanity", () => {
    assert.equal(hasCloneLongVanity("0x00000000000000000000000000000000000000ba3"), true);
    assert.equal(hasCloneLongVanity("0x0000000000000000000000000000000000001e18"), false);
  });
});

describe("Long provenance signal", () => {
  it("trusts a launch hodl proved on chain, without the app.long.xyz fields", () => {
    assert.equal(
      longAuthenticityFromSignals({
        address: "0x1111111111111111111111111111111111111111",
        metadataResolved: true,
        metadata: {name: "ours", attributes: []},
        launchedByHodl: true,
      }),
      true,
    );
  });

  it("still marks the same token a fake without that provenance", () => {
    assert.equal(
      longAuthenticityFromSignals({
        address: "0x1111111111111111111111111111111111111111",
        metadataResolved: true,
        metadata: {name: "ours", attributes: []},
      }),
      false,
    );
  });

  it("does not let provenance override an explicit deny", () => {
    assert.equal(
      longAuthenticityFromSignals({address: FAKE_LONG_EXAMPLE, launchedByHodl: true}),
      false,
    );
    assert.equal(
      longAuthenticityFromSignals({
        address: "0x00000000000000000000000000000000000000ba3",
        launchedByHodl: true,
      }),
      false,
    );
  });
});
