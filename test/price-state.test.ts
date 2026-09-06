import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {MIN_LIQUIDITY_USD} from "../src/config/liquidity.ts";
import {
  applyAgeBounds,
  applyLiveVolumeFilter,
  applyLiquidityBoundFilter,
  applyMeasuredMcapFilter,
  applyNumericBounds,
  formatLiquidityUsd,
  formatMarketCapAt,
  formatMarketCapUsd,
  formatPriceUsd,
  formatVolumeUsd,
  hasVolume24h,
  isMeasuredMcap,
  isPriced,
  isTradeableFromLiquidity,
  isUserBound,
  meetsBound,
  rowPassesFeedBounds,
  rowPassesMarketBounds,
  showsOnNew,
  showsWithVolume24h,
} from "../src/lib/priceState.ts";

const token = (over: Record<string, unknown> = {}) =>
  ({
    kind: "token",
    id: "0xabc",
    priceUsd: 0,
    marketCapUsd: 0,
    circulatingSupply: 1_000_000,
    ...over,
  }) as never;

describe("price states", () => {
  it("does not treat 0 as a priced market", () => {
    assert.equal(isPriced(0), false);
    assert.equal(isPriced(null), false);
    assert.equal(isPriced(undefined), false);
    assert.equal(isPriced(1), true);
  });

  it("never prints $0 for an unpriced token", () => {
    assert.equal(formatMarketCapUsd(0, false), "—");
    assert.equal(formatMarketCapUsd(0, true), "—");
    assert.equal(formatPriceUsd(0), "—");
    assert.equal(formatMarketCapAt(token(), 0), "—");
    assert.equal(formatLiquidityUsd(0), "—");
    assert.equal(formatLiquidityUsd(null), "—");
    assert.doesNotMatch(formatMarketCapUsd(0, false), /\$0/);
    assert.doesNotMatch(formatPriceUsd(0), /\$0/);
  });

  it("fails if a null price renders as zero", () => {
    for (const formatted of [
      formatPriceUsd(null),
      formatPriceUsd(undefined),
      formatMarketCapUsd(null, false),
      formatMarketCapUsd(undefined, true),
      formatLiquidityUsd(null),
      formatVolumeUsd(null),
      formatVolumeUsd(0),
      formatMarketCapAt(token({priceUsd: null, marketCapUsd: null}), 0),
    ]) {
      assert.equal(formatted, "—");
      assert.doesNotMatch(formatted, /0/);
      assert.doesNotMatch(formatted, /\$/);
    }
  });

  it("shows a real priced cap and a dust-priced floor", () => {
    assert.equal(formatMarketCapAt(token({circulatingSupply: 1_000_000}), 1), "$1M");
    assert.equal(formatMarketCapUsd(0.001, true), "<$0.01");
  });

  it("does not treat a null market cap as a measured value", () => {
    assert.equal(isMeasuredMcap({priced_at: null, last_mcap: null}), false);
    assert.equal(isMeasuredMcap({last_mcap: 5000}), false);
    assert.equal(showsOnNew({priced_at: null, last_mcap: null}), false);
    assert.equal(showsOnNew({priced_at: "2026-01-01T00:00:00.000Z", last_mcap: 5_000}), true);
    assert.equal(showsOnNew({priced_at: "2026-01-01T00:00:00.000Z", last_mcap: 0}), false);
    assert.equal(showsOnNew({price_status: "failed", last_mcap: 5_000}), false);
  });

  it("measures tradeable from liquidity, not from a missing price", () => {
    assert.equal(isTradeableFromLiquidity(null), null);
    assert.equal(isTradeableFromLiquidity(undefined), null);
    assert.equal(isTradeableFromLiquidity(50), false);
    assert.equal(isTradeableFromLiquidity(MIN_LIQUIDITY_USD), true);
    assert.equal(isTradeableFromLiquidity(MIN_LIQUIDITY_USD + 1), true);
  });
});

function recordingQuery() {
  const calls: string[] = [];
  const query = {
    calls,
    gte(column: string, value: number | string) {
      calls.push(`gte:${column}:${value}`);
      return query;
    },
    lte(column: string, value: number | string) {
      calls.push(`lte:${column}:${value}`);
      return query;
    },
    gt(column: string, value: number) {
      calls.push(`gt:${column}:${value}`);
      return query;
    },
    not(column: string, op: string, value: string) {
      calls.push(`not:${column}:${op}:${value}`);
      return query;
    },
    or(filter: string) {
      calls.push(`or:${filter}`);
      return query;
    },
  };
  return query;
}

describe("explicit numeric bounds", () => {
  it("treats a missing value as failing a set minimum", () => {
    assert.equal(meetsBound(null, 50_000, null), false);
    assert.equal(meetsBound(undefined, 50_000, null), false);
    assert.equal(meetsBound(Number.NaN, 50_000, null), false);
    assert.equal(meetsBound(49_999, 50_000, null), false);
    assert.equal(meetsBound(50_000, 50_000, null), true);
    assert.equal(meetsBound(80_000, 50_000, null), true);
  });

  it("excludes null liquidity when a min is set", () => {
    assert.equal(meetsBound(null, 1_000, null), false);
    assert.equal(meetsBound(999, 1_000, null), false);
    assert.equal(meetsBound(1_000, 1_000, null), true);
  });

  it("excludes null when only a max is set", () => {
    assert.equal(meetsBound(null, null, 100_000), false);
    assert.equal(meetsBound(100_001, null, 100_000), false);
    assert.equal(meetsBound(50_000, null, 100_000), true);
  });

  it("passes any value including null when no bound is set", () => {
    assert.equal(isUserBound(null, null), false);
    assert.equal(isUserBound(0, 0), false);
    assert.equal(meetsBound(null, null, null), true);
    assert.equal(meetsBound(undefined, 0, 0), true);
    assert.equal(meetsBound(12, null, null), true);
  });

  it("never returns a null-valued row from New or Trending predicates", () => {
    const minCap = {
      minMarketCap: 50_000,
      minLiquidity: null,
    };
    assert.equal(
      rowPassesMarketBounds({mcap: null, liq: 10_000, ...minCap}),
      false,
    );
    assert.equal(
      rowPassesMarketBounds({mcap: 12_000, liq: 10_000, ...minCap}),
      false,
    );
    assert.equal(
      rowPassesMarketBounds({mcap: 50_000, liq: 10_000, ...minCap}),
      true,
    );

    const minLiq = {
      minMarketCap: null,
      minLiquidity: 5_000,
    };
    assert.equal(
      rowPassesMarketBounds({mcap: 80_000, liq: null, ...minLiq}),
      false,
    );
    assert.equal(
      rowPassesMarketBounds({mcap: 80_000, liq: 4_999, ...minLiq}),
      false,
    );
    assert.equal(
      rowPassesMarketBounds({mcap: 80_000, liq: 5_000, ...minLiq}),
      true,
    );
  });

  it("keeps unmeasured liquidity when no user min is set", () => {
    assert.equal(
      rowPassesMarketBounds({mcap: null, liq: null, tradeable: null}),
      true,
    );
    assert.equal(
      rowPassesMarketBounds({
        mcap: null,
        liq: MIN_LIQUIDITY_USD - 1,
        tradeable: null,
      }),
      false,
    );
    assert.equal(
      rowPassesMarketBounds({mcap: null, liq: null, tradeable: false}),
      false,
    );
  });

  it("builds .gte / .lte and never an is-null keep for a user min", () => {
    const mcap = recordingQuery();
    applyNumericBounds(mcap, "last_mcap", 50_000, null);
    assert.deepEqual(mcap.calls, ["gte:last_mcap:50000"]);

    const trending = recordingQuery();
    applyNumericBounds(trending, "last_mcap", 50_000, 1_000_000);
    applyNumericBounds(trending, "liquidity_usd", 2_000, null);
    assert.deepEqual(trending.calls, [
      "gte:last_mcap:50000",
      "lte:last_mcap:1000000",
      "gte:liquidity_usd:2000",
    ]);

    const newTab = recordingQuery();
    applyNumericBounds(newTab, "token_stats.last_mcap", 50_000, null);
    assert.deepEqual(newTab.calls, ["gte:token_stats.last_mcap:50000"]);

    const userMin = recordingQuery();
    applyLiquidityBoundFilter(userMin, 5_000, null);
    assert.deepEqual(userMin.calls, ["gte:liquidity_usd:5000"]);
    assert.ok(!userMin.calls.some((call) => call.startsWith("or:")));

    const defaultFloor = recordingQuery();
    applyLiquidityBoundFilter(defaultFloor, null, null);
    assert.deepEqual(defaultFloor.calls, [
      "or:is_tradeable.is.null,is_tradeable.is.true",
    ]);
  });

  it("never returns a null-volume row from a min volume bound", () => {
    const minVol = {minVolume: 1_000};
    assert.equal(
      rowPassesFeedBounds({mcap: 80_000, liq: 10_000, volume: null, ...minVol}),
      false,
    );
    assert.equal(
      rowPassesFeedBounds({mcap: 80_000, liq: 10_000, volume: 999, ...minVol}),
      false,
    );
    assert.equal(
      rowPassesFeedBounds({mcap: 80_000, liq: 10_000, volume: 1_000, ...minVol}),
      true,
    );
  });

  it("never returns a null createdAt from a min age bound", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    const minAge = {minAgeHours: 3, now};
    assert.equal(
      rowPassesFeedBounds({
        mcap: 80_000,
        liq: 10_000,
        createdAt: null,
        ...minAge,
      }),
      false,
    );
    assert.equal(
      rowPassesFeedBounds({
        mcap: 80_000,
        liq: 10_000,
        createdAt: "2026-01-01T23:00:00.000Z",
        ...minAge,
      }),
      false,
    );
    assert.equal(
      rowPassesFeedBounds({
        mcap: 80_000,
        liq: 10_000,
        createdAt: "2026-01-01T12:00:00.000Z",
        ...minAge,
      }),
      true,
    );
  });

  it("builds .gte / .lte for volume and age timestamps", () => {
    const vol = recordingQuery();
    applyNumericBounds(vol, "vol_24h", 1_000, 50_000);
    applyNumericBounds(vol, "token_stats.vol_24h", 2_000, null);
    assert.deepEqual(vol.calls, [
      "gte:vol_24h:1000",
      "lte:vol_24h:50000",
      "gte:token_stats.vol_24h:2000",
    ]);

    const now = Date.parse("2026-01-02T00:00:00.000Z");
    const age = recordingQuery();
    applyAgeBounds(age, 3, 24, now);
    assert.deepEqual(age.calls, [
      "lte:created_at:2026-01-01T21:00:00.000Z",
      "gte:created_at:2026-01-01T00:00:00.000Z",
    ]);
    assert.ok(!age.calls.some((call) => /is\.null|IS NOT NULL/i.test(call)));

    const none = recordingQuery();
    applyAgeBounds(none, null, 0, now);
    assert.deepEqual(none.calls, []);
  });

  it("requires priced_at plus last_mcap > 0 via .gt", () => {
    const q = recordingQuery();
    applyMeasuredMcapFilter(q, "token_stats");
    assert.deepEqual(q.calls, [
      "not:token_stats.priced_at:is:null",
      "gt:token_stats.last_mcap:0",
    ]);
    assert.ok(!q.calls.some((call) => /last_mcap.*is:null/i.test(call)));
  });
});

describe("live 24h volume browse gate", () => {
  it("hides zero and null volume, shows a positive print", () => {
    assert.equal(hasVolume24h(0), false);
    assert.equal(hasVolume24h(null), false);
    assert.equal(hasVolume24h(undefined), false);
    assert.equal(hasVolume24h(Number.NaN), false);
    assert.equal(hasVolume24h(1), true);
    assert.equal(showsWithVolume24h(0), false);
    assert.equal(showsWithVolume24h(null), false);
    assert.equal(showsWithVolume24h(12), true);
    assert.equal(formatVolumeUsd(0), "—");
    assert.equal(formatVolumeUsd(null), "—");
    assert.equal(formatVolumeUsd(12), "$12.00");
  });

  it("hides New rows with -- volume even if they just listed", () => {
    assert.equal(showsWithVolume24h(0), false);
    assert.equal(showsWithVolume24h(null), false);
    assert.equal(showsWithVolume24h(undefined), false);
    assert.equal(hasVolume24h(0), false);
  });

  it("builds vol_24h > 0 and never a cross-table or() on New", () => {
    const trending = recordingQuery();
    applyLiveVolumeFilter(trending);
    assert.deepEqual(trending.calls, ["gt:vol_24h:0"]);

    const prefixed = recordingQuery();
    applyLiveVolumeFilter(prefixed, {columnPrefix: "token_stats"});
    assert.deepEqual(prefixed.calls, ["gt:token_stats.vol_24h:0"]);
    assert.ok(!prefixed.calls.some((call) => call.startsWith("or:")));
    assert.ok(!prefixed.calls.some((call) => /eligible|is_tradeable/i.test(call)));
  });
});
