import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {
  DUST_USD,
  commentPosition,
  positionCanComment,
} from "../src/lib/commentPosition";

/**
 * The position line sits next to someone's opinion and says what they did.
 *
 * It has to be right or silent. A wrong percentage beside a take is worse
 * than no percentage, because it reads as evidence — so most of these tests
 * are about the cases where it must decline to say anything.
 */
describe("comment position", () => {
  it("reports a live holding's return against its cost", () => {
    const p = commentPosition({amount: 100, valueUsd: 160, costUsd: 100});
    assert.equal(p?.status, "holding");
    assert.equal(p?.gainPct, 60);
    assert.equal(p?.boughtUsd, 100);
  });

  it("reports a loss as a loss", () => {
    const p = commentPosition({amount: 100, valueUsd: 40, costUsd: 100});
    assert.equal(p?.gainPct, -60);
    assert.equal(p?.status, "holding");
  });

  it("says nothing about someone with no position at all", () => {
    assert.equal(commentPosition(null), null);
    assert.equal(commentPosition({amount: 0, valueUsd: 0, costUsd: null}), null);
  });

  it("shows no percentage when there is no cost basis", () => {
    // A holder we started tracking late is not someone who is up 0%.
    const p = commentPosition({amount: 100, valueUsd: 500, costUsd: null});
    assert.equal(p?.status, "holding");
    assert.equal(p?.gainPct, null);
    assert.equal(p?.boughtUsd, 0);
  });

  it("calls a sold-out position sold, without printing -100%", () => {
    // Current value is zero once it is gone, so a percentage from it would
    // read as a total loss rather than as whatever they actually got out.
    const p = commentPosition({amount: 0, valueUsd: 0, costUsd: 250});
    assert.equal(p?.status, "sold");
    assert.equal(p?.gainPct, null);
    assert.equal(p?.boughtUsd, 250);
  });

  it("treats router dust as sold, not as holding", () => {
    const p = commentPosition({amount: 0.000001, valueUsd: DUST_USD / 2, costUsd: 100});
    assert.equal(p?.status, "sold");
  });

  it("survives a row with non-finite numbers rather than rendering NaN%", () => {
    const p = commentPosition({amount: NaN, valueUsd: Infinity, costUsd: 100});
    assert.equal(p?.status, "sold");
    assert.ok(p?.gainPct === null || Number.isFinite(p.gainPct));
  });
});

describe("who may comment", () => {
  it("lets a real holder speak", () => {
    assert.equal(positionCanComment({amount: 10, valueUsd: 50, costUsd: 40}), true);
  });

  it("does not let someone who sold, or never held, speak", () => {
    assert.equal(positionCanComment(null), false);
    assert.equal(positionCanComment({amount: 0, valueUsd: 0, costUsd: 900}), false);
  });

  it("does not silence a holder whose price we could not read", () => {
    // A pricing outage must not look like selling out.
    assert.equal(positionCanComment({amount: 1000, valueUsd: 0, costUsd: null}), true);
  });

  it("refuses dust", () => {
    assert.equal(
      positionCanComment({amount: 0.0001, valueUsd: DUST_USD / 10, costUsd: 5}),
      false,
    );
  });
});
