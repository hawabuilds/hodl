import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {CASH_COLOR, ETH_KEY, USD_COLOR, USDG_KEY, buildRows, donutSlices} from "../src/lib/portfolioView.ts";
import type {Holding} from "../src/lib/types.ts";

const holding = (symbol: string, valueUsd: number, extra: Partial<Holding> = {}): Holding => ({
  kind: "token",
  assetId: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
  symbol,
  name: symbol,
  logoUrl: null,
  amount: 1000,
  valueUsd,
  changePct: 0,
  costUsd: null,
  ...extra,
});

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10;

describe("USDG as a cash row", () => {
  it("shows as USD with USDG underneath, at $1.00, tagged Cash", () => {
    const rows = buildRows([holding("ORBIO", 3)], 0, 0, false, 9.39);
    const usd = rows.find((row) => row.key === USDG_KEY)!;
    assert.equal(usd.symbol, "USD");
    assert.equal(usd.unit, "USDG");
    assert.equal(usd.kind, "cash");
    assert.equal(usd.holding, null);
    assert.equal(usd.amount, 9.39);
    assert.equal(usd.valueUsd, 9.39);
    assert.equal(usd.priceState, "live");
    assert.equal(usd.pnlUsd, null);
    // Its own grey, next to ETH's, so the two cash slices never merge.
    assert.equal(usd.color, USD_COLOR);
    assert.notEqual(USD_COLOR, CASH_COLOR);
  });

  it("counts toward the shares: tokens, ETH and USDG add up to exactly 100", () => {
    const rows = buildRows(
      [holding("AI", 182.5), holding("NVDA", 74.04, {kind: "rwa", assetId: "nvda"})],
      0.0167,
      44.86,
      false,
      48.2,
    );
    assert.deepEqual(rows.map((row) => row.symbol), ["AI", "NVDA", "USD", "ETH"]);
    assert.equal(sum(rows.map((row) => row.share)), 100);
    const total = 182.5 + 74.04 + 44.86 + 48.2;
    const usd = rows.find((row) => row.key === USDG_KEY)!;
    assert.ok(Math.abs(usd.share - (48.2 / total) * 100) < 0.1);
  });

  it("gets its own slice in the allocation donut", () => {
    const rows = buildRows([holding("AI", 50)], 0.01, 20, false, 30);
    const slices = donutSlices(rows);
    assert.deepEqual(slices.map((slice) => slice.label), ["AI", "USD", "ETH"]);
    assert.equal(sum(slices.map((slice) => slice.share)), 100);
  });

  it("is the whole allocation when it is all the wallet holds", () => {
    const rows = buildRows([], 0, 0, false, 12);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].share, 100);
  });

  it("does not show a zero balance, and ETH still shows on its own", () => {
    const rows = buildRows([holding("AI", 50)], 0.02, 50, false, 0);
    assert.equal(rows.some((row) => row.key === USDG_KEY), false);
    assert.equal(rows.some((row) => row.key === ETH_KEY), true);
  });

  it("keeps its value while the ETH price is still loading", () => {
    const rows = buildRows([], 0.02, 0, true, 10);
    const usd = rows.find((row) => row.key === USDG_KEY)!;
    assert.equal(usd.valueUsd, 10);
    assert.equal(usd.priceState, "live");
  });
});
