import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  CASH_COLOR,
  OTHERS_COLOR,
  buildRows,
  compactAmount,
  donutSlices,
  roundedShares,
  signedPct,
  totalPnl,
} from "../src/lib/portfolioView.ts";
import {applyCostBasis, type TradeRow} from "../src/lib/server/live/costBasis.ts";
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

describe("portfolio rows", () => {
  it("counts ETH as a holding and shares add up to exactly 100", () => {
    const rows = buildRows(
      [holding("AI", 182.5), holding("MEME", 96.2), holding("NVDA", 74.04, {kind: "rwa", assetId: "nvda"})],
      0.0167,
      44.86,
    );
    assert.deepEqual(rows.map((row) => row.symbol), ["AI", "MEME", "NVDA", "ETH"]);
    assert.equal(sum(rows.map((row) => row.share)), 100);
    const eth = rows.find((row) => row.kind === "cash")!;
    assert.equal(eth.color, CASH_COLOR);
    assert.equal(eth.pnlUsd, null);
  });

  it("the donut shows NVDA's real share, not 100%, once ETH is held", () => {
    const rows = buildRows([holding("NVDA", 62.3, {kind: "rwa", assetId: "nvda"})], 0.02, 37.7);
    const slices = donutSlices(rows);
    assert.deepEqual(slices.map((slice) => [slice.label, slice.share]), [["NVDA", 62.3], ["ETH", 37.7]]);
  });

  it("filter counts add up: All = Tokens + RWAs + Cash", () => {
    const rows = buildRows(
      [holding("A", 5), holding("B", 4), holding("S", 3, {kind: "rwa", assetId: "s"})],
      1,
      2,
    );
    const by = (kind: string) => rows.filter((row) => row.kind === kind).length;
    assert.equal(rows.length, by("token") + by("rwa") + by("cash"));
  });

  it("7 holdings all show; 9 holdings fold into six plus Others", () => {
    const seven = buildRows(Array.from({length: 6}, (_, i) => holding(`T${i}`, 100 - i)), 1, 10);
    assert.equal(donutSlices(seven).length, 7);
    assert.ok(donutSlices(seven).every((slice) => slice.label !== "Others"));

    const nine = buildRows(Array.from({length: 8}, (_, i) => holding(`T${i}`, 100 - i * 7)), 1, 3);
    const slices = donutSlices(nine);
    assert.equal(slices.length, 7);
    assert.equal(slices[6].label, "Others");
    assert.equal(slices[6].count, 3);
    assert.equal(sum(slices.map((slice) => slice.share)), 100);
    // Rows folded into Others share its colour; the six on show are all different.
    const shown = new Set(nine.slice(0, 6).map((row) => row.color));
    assert.equal(shown.size, 6);
    assert.ok(nine.slice(6).every((row) => row.color === OTHERS_COLOR));
  });

  it("rounds shares by largest remainder", () => {
    assert.equal(sum(roundedShares([1, 1, 1])), 100);
    assert.deepEqual(roundedShares([0, 0]), [0, 0]);
  });

  it("prints amounts compactly and never cut off", () => {
    assert.equal(compactAmount(1_250_000), "1.25M");
    assert.equal(compactAmount(820_000), "820K");
    assert.equal(compactAmount(0.317802), "0.3178");
    assert.equal(compactAmount(0.0167), "0.0167");
    assert.equal(signedPct(13.84), "+13.8%");
    assert.equal(signedPct(-4.8), "−4.8%");
    assert.equal(signedPct(0.001), "0.0%");
  });
});

describe("cost basis", () => {
  const ai = holding("AI", 150, {amount: 50});
  const trade = (side: "buy" | "sell", amount: number, usd: number | null, at: string): TradeRow => ({
    side,
    kind: "token",
    asset_id: ai.assetId.toUpperCase(),
    token_amount: amount,
    usd,
    traded_at: at,
  });

  it("average cost of what is still held, plus realised profit on sells", () => {
    const {holdings, pnl} = applyCostBasis(
      [ai],
      [trade("buy", 100, 200, "2026-01-01"), trade("sell", 50, 150, "2026-01-02")],
    );
    assert.equal(holdings[0].costUsd, 100);
    assert.deepEqual(pnl, {realizedUsd: 50, boughtUsd: 200, firstTradeAt: "2026-01-01"});
    const rows = buildRows(holdings, 0, 0);
    assert.equal(rows[0].pnlUsd, 50);
    assert.equal(rows[0].pnlPct, 50);
    assert.deepEqual(totalPnl(rows, pnl), {usd: 100, pct: 50});
  });

  it("no basis for a balance bigger than what was bought here, or an unreadable buy", () => {
    const more = applyCostBasis([{...ai, amount: 500}], [trade("buy", 100, 200, "2026-01-01")]);
    assert.equal(more.holdings[0].costUsd, null);
    const unknown = applyCostBasis([ai], [trade("buy", 100, null, "2026-01-01")]);
    assert.equal(unknown.holdings[0].costUsd, null);
  });

  it("no trades: no P&L at all", () => {
    assert.equal(applyCostBasis([ai], []).pnl, null);
    assert.equal(totalPnl(buildRows([ai], 0, 0), null), null);
  });
});
