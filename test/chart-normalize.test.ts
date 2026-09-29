import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {normalizeLwcPoints, toLineData, toUtcSeconds} from "../src/lib/chartLwc";

/**
 * Lightweight Charts throws on data that is not strictly ascending in whole
 * seconds, and that throw blanked the entire app. These pin the guarantee the
 * chart relies on.
 */

function strictlyAscending(times: number[]): boolean {
  return times.every((t, i) => i === 0 || t > times[i - 1]);
}

describe("normalizeLwcPoints", () => {
  it("collapses two points in the same second — the case that crashed", () => {
    // The live repro: two prints bucketed to time 1790100540.
    const t = 1_790_100_540_000;
    const out = normalizeLwcPoints([
      {t, price: 1},
      {t: t + 400, price: 2},
      {t: t + 60_000, price: 3},
    ]);
    assert.equal(out.length, 2);
    assert.ok(strictlyAscending(toLineData(out).map((p) => p.time)));
  });

  it("merges rather than drops: first open, last close, both extremes", () => {
    const t = 1_000_000;
    const [bar] = normalizeLwcPoints([
      {t, price: 10, open: 9, high: 12, low: 8},
      {t: t + 500, price: 11, high: 15, low: 7},
    ]);
    assert.deepEqual(bar, {t, price: 11, open: 9, high: 15, low: 7});
  });

  it("sorts out-of-order input", () => {
    const out = normalizeLwcPoints([
      {t: 3000, price: 3},
      {t: 1000, price: 1},
      {t: 2000, price: 2},
    ]);
    assert.deepEqual(out.map((p) => p.price), [1, 2, 3]);
  });

  it("drops points the converters would have dropped, so times stay aligned", () => {
    const out = normalizeLwcPoints([
      {t: 1000, price: 1},
      {t: 2000, price: 0},
      {t: NaN, price: 5},
      {t: 3000, price: Infinity},
      {t: 4000, price: 4},
    ]);
    assert.deepEqual(out.map((p) => p.t), [1000, 4000]);
    // Same length in, same length out of the converter — the invariant
    // withCompressedSessionBreaks indexes on.
    assert.equal(toLineData(out).length, out.length);
  });

  it("never emits a repeated second, whatever it is given", () => {
    const noisy = Array.from({length: 500}, (_, i) => ({
      t: 1_700_000_000_000 + Math.floor(i / 3) * 1000 + (i % 3) * 250,
      price: 1 + i,
    }));
    const secs = normalizeLwcPoints(noisy).map((p) => toUtcSeconds(p.t));
    assert.ok(strictlyAscending(secs));
  });
});
