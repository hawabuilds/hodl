import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {sortRwas, sortTokens} from "../src/lib/feedSorts";
import type {RwaAsset, TokenAsset} from "../src/lib/types";

/**
 * The phone feed and the desktop board both order through these. If they ever
 * disagreed, "Trending" would mean one thing on a phone and another on a
 * monitor — so the behaviour lifted out of the Home page is pinned here.
 */

const token = (symbol: string, over: Partial<TokenAsset>): TokenAsset =>
  ({symbol, marketCapUsd: 0, rewards24hUsd: 0, volume24hUsd: 0, windows: {}, ...over}) as TokenAsset;
const rwa = (ticker: string, over: Partial<RwaAsset>): RwaAsset =>
  ({ticker, marketCapUsd: 0, changePct: 0, ...over}) as RwaAsset;

describe("feed sorts", () => {
  it("ranks by market cap, treating a missing cap as zero", () => {
    const out = sortTokens(
      [token("A", {marketCapUsd: 5}), token("B", {marketCapUsd: undefined as never}), token("C", {marketCapUsd: 9})],
      "marketCap",
    );
    assert.deepEqual(out.map((t) => t.symbol), ["C", "A", "B"]);
  });

  it("does not reorder the caller's array", () => {
    const input = [token("A", {marketCapUsd: 1}), token("B", {marketCapUsd: 2})];
    sortTokens(input, "marketCap");
    assert.deepEqual(input.map((t) => t.symbol), ["A", "B"]);
  });

  it("ranks movers by the size of the move, not its direction", () => {
    const out = sortRwas(
      [rwa("UP", {changePct: 3}), rwa("DOWN", {changePct: -9}), rwa("FLAT", {changePct: 0.1})],
      "movers",
    );
    assert.deepEqual(out.map((r) => r.ticker), ["DOWN", "UP", "FLAT"]);
  });

  it("ranks stocks by market cap otherwise", () => {
    const out = sortRwas([rwa("S", {marketCapUsd: 1}), rwa("L", {marketCapUsd: 50})], "marketCap");
    assert.deepEqual(out.map((r) => r.ticker), ["L", "S"]);
  });
});
