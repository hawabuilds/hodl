import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {priceMoved} from "../src/lib/server/live/onchainPrice";
import {nextDormantCursor} from "../src/lib/server/live/universeStore";

describe("price moved", () => {
  it("is a swap: any change in the pool price", () => {
    assert.equal(priceMoved(0.0000025829, 0.0000025831), true);
    assert.equal(priceMoved(0.0000025829, 0.0000025829), false);
  });

  it("counts a token's first reading as a move, so a new listing starts active", () => {
    assert.equal(priceMoved(null, 0.001), true);
    assert.equal(priceMoved(0, 0.001), true);
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
