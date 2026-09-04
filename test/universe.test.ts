import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  isListed,
  isRwaPaired,
  paysHoldersInRwa,
  qualifiesForUniverse,
  quoteKindFor,
  statusFor,
} from "../src/lib/universe";

describe("universe rule", () => {
  it("lists a bonded Pons token paired against an RWA", () => {
    const input = {
      launchpad: "pons" as const,
      quoteKind: "rwa" as const,
      rewardRwa: null,
      bonded: true,
    };
    assert.equal(isRwaPaired(input), true);
    assert.equal(statusFor(input), "listed");
    assert.equal(qualifiesForUniverse(input), true);
    assert.equal(isListed(input), true);
  });

  it("stores an unbonded Pons RWA pair as pending, not shown", () => {
    const input = {
      launchpad: "pons" as const,
      quoteKind: "rwa" as const,
      rewardRwa: null,
      bonded: false,
    };
    assert.equal(statusFor(input), "pending");
    assert.equal(qualifiesForUniverse(input), true);
    assert.equal(isListed(input), false);
  });

  it("lists a Long launch immediately", () => {
    const input = {
      launchpad: "long" as const,
      quoteKind: "rwa" as const,
      rewardRwa: null,
      bonded: false,
    };
    assert.equal(statusFor(input), "listed");
    assert.equal(isListed(input), true);
  });

  it("rejects a Long ETH pair that does not pay holders in an RWA", () => {
    const input = {
      launchpad: "long" as const,
      quoteKind: "eth" as const,
      rewardRwa: null,
      bonded: false,
    };
    assert.equal(qualifiesForUniverse(input), false);
    assert.equal(isListed(input), false);
  });

  it("lists an ETH-paired token only when it pays an RWA", () => {
    const base = {
      launchpad: "pons" as const,
      quoteKind: "eth" as const,
      bonded: true,
    };
    assert.equal(paysHoldersInRwa({...base, rewardRwa: null}), false);
    assert.equal(qualifiesForUniverse({...base, rewardRwa: null}), false);
    assert.equal(qualifiesForUniverse({...base, rewardRwa: "NVDA"}), true);
    assert.equal(isListed({...base, rewardRwa: "NVDA"}), true);
  });

  it("rejects a token from no launchpad even if it pays rewards", () => {
    const input = {
      launchpad: null,
      quoteKind: "eth" as const,
      rewardRwa: "NVDA",
      bonded: true,
    };
    assert.equal(qualifiesForUniverse(input), false);
    assert.equal(isListed(input), false);
  });

  it("classifies quote addresses", () => {
    assert.equal(
      quoteKindFor("0x5fc5360d0400a0fd4f2af552add042d716f1d168", false),
      "usdg",
    );
    assert.equal(
      quoteKindFor("0x0bd7d308f8e1639fab988df18a8011f41eacad73", false),
      "eth",
    );
    assert.equal(quoteKindFor("0xabc", true), "rwa");
  });
});
