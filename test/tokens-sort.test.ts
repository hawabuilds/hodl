import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {sortRows, sortValue, type TokensTableRow} from "../src/lib/tokensTable.ts";
import type {TokenAsset} from "../src/lib/types.ts";

const row = (id: string, a: Partial<TokenAsset>, buys: number | null = null, sells: number | null = null): TokensTableRow => ({
  asset: {
    kind: "token",
    id,
    address: `0x${id.padStart(40, "0")}`,
    symbol: id,
    name: id,
    priceUsd: 1,
    changePct: 0,
    marketCapUsd: null,
    liquidityUsd: 0,
    volume24hUsd: 0,
    circulatingSupply: null,
    listedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    series: [],
    ...a,
  } as TokenAsset,
  buys,
  sells,
  tradedAt: null,
});

const ids = (rows: TokensTableRow[]) => rows.map((r) => r.asset.symbol);

describe("tokens table sorts by the value each cell shows", () => {
  it("market cap by number, not text: $1.2M after... before $900K going down", () => {
    const rows = [row("a", {marketCapUsd: 900_000}), row("b", {marketCapUsd: 1_200_000}), row("c", {marketCapUsd: 50_000})];
    assert.deepEqual(ids(sortRows(rows, {sort: "mcap", desc: true})), ["b", "a", "c"]);
    assert.deepEqual(ids(sortRows(rows, {sort: "mcap", desc: false})), ["c", "a", "b"]);
  });

  it("market cap is supply × the shown price when supply is known", () => {
    const r = row("a", {priceUsd: 2, circulatingSupply: 1_000, marketCapUsd: 5});
    assert.equal(sortValue(r, "mcap"), 2_000);
  });

  it("24h change: −5% before +2% going up, signed numbers", () => {
    const rows = [row("up", {changePct: 2}), row("down", {changePct: -5}), row("flat", {changePct: 0})];
    assert.deepEqual(ids(sortRows(rows, {sort: "change", desc: false})), ["down", "flat", "up"]);
    assert.deepEqual(ids(sortRows(rows, {sort: "change", desc: true})), ["up", "flat", "down"]);
  });

  it("missing values go last in both directions", () => {
    const rows = [row("none", {volume24hUsd: 0}), row("big", {volume24hUsd: 1_000}), row("small", {volume24hUsd: 10})];
    assert.deepEqual(ids(sortRows(rows, {sort: "vol", desc: true})), ["big", "small", "none"]);
    assert.deepEqual(ids(sortRows(rows, {sort: "vol", desc: false})), ["small", "big", "none"]);
    const unpriced = [row("np", {priceUsd: 0, marketCapUsd: 10}), row("p", {marketCapUsd: 5})];
    assert.deepEqual(ids(sortRows(unpriced, {sort: "mcap", desc: false})), ["p", "np"]);
  });

  it("buys + sells, and age newest first when high to low", () => {
    const rows = [row("a", {}, 10, 5), row("b", {}, 1, 1), row("c", {})];
    assert.deepEqual(ids(sortRows(rows, {sort: "txns", desc: true})), ["a", "b", "c"]);
    const aged = [row("old", {listedAt: "2026-09-01T00:00:00Z"}), row("new", {listedAt: "2026-10-03T00:00:00Z"})];
    assert.deepEqual(ids(sortRows(aged, {sort: "age", desc: true})), ["new", "old"]);
  });

  it("uses the browser's fresher copy of a token when given one", () => {
    const rows = [row("a", {volume24hUsd: 5}), row("b", {volume24hUsd: 10})];
    const fresher = (asset: TokenAsset) => (asset.symbol === "a" ? {...asset, volume24hUsd: 50} : asset);
    assert.deepEqual(ids(sortRows(rows, {sort: "vol", desc: true}, fresher)), ["a", "b"]);
  });
});
