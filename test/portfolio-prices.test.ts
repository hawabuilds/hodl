import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildRows, donutSlices, totalPnl, withLastKnownPrices} from "../src/lib/portfolioView.ts";
import type {Holding} from "../src/lib/types.ts";

const nvda = (extra: Partial<Holding> = {}): Holding => ({
  kind: "rwa",
  assetId: "nvda",
  symbol: "NVDA",
  name: "NVIDIA",
  logoUrl: null,
  amount: 0.3178,
  valueUsd: 74.04,
  changePct: 0,
  costUsd: 75,
  priceUsd: 232.98,
  priceState: "live",
  ...extra,
});

describe("a missing price is never a price of zero", () => {
  it("a pending holding has no P&L and no share, instead of −100% and 0%", () => {
    const rows = buildRows([nvda({valueUsd: 0, priceUsd: null, priceState: "pending"})], 0.0167, 44.74);
    const row = rows.find((r) => r.symbol === "NVDA")!;
    assert.equal(row.priceState, "pending");
    assert.equal(row.pnlUsd, null);
    assert.equal(row.pnlPct, null);
    assert.equal(row.share, 0);
    // Total P&L does not count the pending holding as a loss.
    assert.equal(totalPnl(rows, null), null);
  });

  it("an ETH price still loading makes ETH pending, not $0", () => {
    const rows = buildRows([nvda()], 0.0167, 0, true);
    const eth = rows.find((r) => r.kind === "cash")!;
    assert.equal(eth.priceState, "pending");
    assert.deepEqual(donutSlices(rows).map((s) => s.label), ["NVDA"]);
  });

  it("a stale price still counts, marked stale", () => {
    const rows = buildRows([nvda({priceState: "stale", priceAt: "2026-10-03T12:00:00Z"})], 0.0167, 44.74);
    const row = rows.find((r) => r.symbol === "NVDA")!;
    assert.equal(row.priceState, "stale");
    assert.equal(Math.round(row.share * 10) / 10, 62.3);
    assert.ok(row.pnlUsd != null);
  });
});


describe("last known prices", () => {
  it("a pending holding takes this device's last price for it, marked stale", () => {
    const cache = {holdings: [nvda()], savedAt: Date.parse("2026-10-03T12:11:00Z")};
    const [row] = withLastKnownPrices([nvda({valueUsd: 0, priceUsd: null, priceState: "pending"})], cache);
    assert.equal(row.priceState, "stale");
    assert.equal(Math.round(row.valueUsd * 100) / 100, 74.04);
    assert.equal(row.priceAt, "2026-10-03T12:11:00.000Z");
  });

  it("with nothing to fall back on it stays pending", () => {
    const [row] = withLastKnownPrices([nvda({valueUsd: 0, priceUsd: null, priceState: "pending"})], null);
    assert.equal(row.priceState, "pending");
  });
});
