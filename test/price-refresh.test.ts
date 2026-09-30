import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {movedAt, priceMoved} from "../src/lib/server/live/onchainPrice";
import {nextDormantCursor} from "../src/lib/server/live/universeStore";

describe("price moved", () => {
  it("is a swap: a change in the pool price beyond source noise", () => {
    assert.equal(priceMoved(0.0000025829, 0.0000026), true);
    assert.equal(priceMoved(0.0000025829, 0.0000025829), false);
    // Two sources a hair apart are not a trade.
    assert.equal(priceMoved(0.0000025829, 0.0000025831), false);
  });

  it("counts a token's first reading as a move, so a new listing starts active", () => {
    assert.equal(priceMoved(null, 0.001), true);
    assert.equal(priceMoved(0, 0.001), true);
  });
});

describe("when a token last moved", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it("is now when the price moved since a reading taken in the last day", () => {
    assert.equal(
      movedAt({previousPrice: 1, previousPricedAt: hoursAgo(1), previousMovedAt: null, price: 1.2, now}),
      new Date(now).toISOString(),
    );
  });

  it("is the old reading's time when that reading is weeks old", () => {
    // A move since three weeks ago proves a trade in those weeks, not today.
    assert.equal(
      movedAt({previousPrice: 1, previousPricedAt: hoursAgo(21 * 24), previousMovedAt: null, price: 1.2, now}),
      hoursAgo(21 * 24),
    );
  });

  it("keeps the old mark when nothing moved", () => {
    assert.equal(
      movedAt({previousPrice: 1, previousPricedAt: hoursAgo(1), previousMovedAt: hoursAgo(30), price: 1, now}),
      hoursAgo(30),
    );
  });

  it("is now for a token's first reading", () => {
    assert.equal(
      movedAt({previousPrice: null, previousPricedAt: null, previousMovedAt: null, price: 1, now}),
      new Date(now).toISOString(),
    );
  });
});

describe("dormant sweep position", () => {
  const rows = (...ms: number[]) => ms.map((pricedAtMs) => ({pricedAtMs}));

  it("wraps to the start once it reaches the end of the stale range", () => {
    assert.equal(nextDormantCursor({scanned: rows(10, 20, 30), stoppedAt: 2, pageFull: false}), 0);
    assert.equal(nextDormantCursor({scanned: [], stoppedAt: 0, pageFull: false}), 0);
  });

  it("resumes just before the last token taken when the page filled first", () => {
    assert.equal(nextDormantCursor({scanned: rows(10, 20, 30, 40), stoppedAt: 1, pageFull: false}), 19);
  });

  it("moves past a full page of tokens that are no longer listed", () => {
    assert.equal(nextDormantCursor({scanned: rows(10, 20, 30), stoppedAt: 2, pageFull: true}), 29);
  });

  it("steps past a full page written in one millisecond instead of stalling", () => {
    assert.equal(nextDormantCursor({scanned: rows(50, 50, 50), stoppedAt: 2, pageFull: true}), 50);
  });
});
