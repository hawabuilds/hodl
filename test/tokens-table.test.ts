import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ORDER,
  countLabel,
  decodeCursor,
  nextOrder,
  parseSort,
  parseTab,
  stableRows,
} from "../src/lib/tokensTable";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const row = (address: string, value: number) => ({asset: {address}, value});

describe("tokens table sorting", () => {
  it("sorts a new column high to low, and flips on a second click", () => {
    const first = nextOrder(DEFAULT_ORDER.trending, "change");
    assert.deepEqual(first, {sort: "change", desc: true});
    assert.deepEqual(nextOrder(first, "change"), {sort: "change", desc: false});
    assert.deepEqual(nextOrder({sort: "change", desc: false}, "change"), {sort: "change", desc: true});
  });

  it("opens each tab on its own order", () => {
    assert.deepEqual(DEFAULT_ORDER.trending, {sort: "vol", desc: true});
    assert.deepEqual(DEFAULT_ORDER.new, {sort: "age", desc: true});
    assert.deepEqual(DEFAULT_ORDER.following, {sort: "recent", desc: true});
    assert.deepEqual(DEFAULT_ORDER.watchlist, {sort: "vol", desc: true});
  });

  it("falls back to the tab's default for an unknown sort", () => {
    assert.equal(parseSort("bogus", "new"), "age");
    assert.equal(parseSort(undefined, "trending"), "vol");
    assert.equal(parseSort("liq", "new"), "liq");
  });

  it("only lets Following sort by last trade", () => {
    assert.equal(parseSort("recent", "following"), "recent");
    assert.equal(parseSort("recent", "trending"), "vol");
  });

  it("reads unknown tabs as Trending", () => {
    assert.equal(parseTab("watchlist"), "watchlist");
    assert.equal(parseTab("graduating"), "trending");
    assert.equal(parseTab(null), "trending");
  });
});

describe("tokens table cursor", () => {
  it("keeps a keyset cursor's exact text value", () => {
    assert.deepEqual(decodeCursor({k: "0.000002582900000001", a: "0x" + "A".repeat(40), n: false}), {
      k: "0.000002582900000001",
      a: A,
      n: false,
    });
    assert.deepEqual(decodeCursor({k: null, a: A, n: true}), {k: null, a: A, n: true});
  });

  it("accepts an offset cursor", () => {
    assert.deepEqual(decodeCursor({o: 50.7}), {o: 50});
  });

  it("rejects anything else", () => {
    assert.equal(decodeCursor(null), null);
    assert.equal(decodeCursor("x"), null);
    assert.equal(decodeCursor({o: -1}), null);
    assert.equal(decodeCursor({k: "1", a: "not-an-address"}), null);
  });
});

describe("tokens table buys and sells", () => {
  it("shows whole numbers with separators, or a dash with no data", () => {
    assert.equal(countLabel(1842), "1,842");
    assert.equal(countLabel(0), "0");
    assert.equal(countLabel(null), "—");
    assert.equal(countLabel(undefined), "—");
    assert.equal(countLabel(Number.NaN), "—");
  });
});

describe("tokens table live rows", () => {
  it("takes the latest order when nobody is reading", () => {
    const latest = [row(B, 2), row(A, 1)];
    assert.equal(stableRows([row(A, 1), row(B, 1)], latest, false), latest);
  });

  it("keeps the order on screen while frozen, with fresh values", () => {
    const shown = [row(A, 1), row(B, 1)];
    const next = stableRows(shown, [row(B, 9), row(A, 5)], true);
    assert.deepEqual(
      next.map((r) => [r.asset.address, r.value]),
      [
        [A, 5],
        [B, 9],
      ],
    );
  });

  it("appends newly loaded rows after what is on screen", () => {
    const next = stableRows([row(A, 1)], [row(C, 3), row(A, 2)], true);
    assert.deepEqual(
      next.map((r) => r.asset.address),
      [A, C],
    );
  });

  it("keeps a row that dropped out of the latest data while frozen", () => {
    const next = stableRows([row(A, 1), row(B, 1)], [row(A, 2)], true);
    assert.deepEqual(
      next.map((r) => [r.asset.address, r.value]),
      [
        [A, 2],
        [B, 1],
      ],
    );
  });
});
