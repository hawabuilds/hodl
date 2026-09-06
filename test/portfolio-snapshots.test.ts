import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  bucketSnapshots,
  changeFromPoints,
  chartPointsFromSnapshots,
  filterSnapshotsInRange,
  hourBucketUtc,
  parsePortfolioRange,
  PORTFOLIO_RANGES,
  shouldWriteSnapshot,
  SNAPSHOT_INTERVAL_MS,
  snapshotWallets,
  type EquitySnapshot,
} from "../src/lib/server/live/portfolioSnapshots.ts";

const WALLET = "0xaaa0000000000000000000000000000000000001";
const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function snap(hoursAgo: number, totalUsd: number, wallet = WALLET): EquitySnapshot {
  return {
    wallet,
    capturedAt: NOW - hoursAgo * 3_600_000,
    totalUsd,
  };
}

describe("portfolio snapshot intervals", () => {
  it("includes 1H among the chart windows", () => {
    assert.deepEqual(PORTFOLIO_RANGES, ["1H", "1D", "1W", "1M", "1Y", "ALL"]);
    assert.equal(parsePortfolioRange("1H"), "1H");
    assert.equal(parsePortfolioRange("1h"), null);
    assert.equal(parsePortfolioRange("2D"), null);
  });

  it("keeps 1H points inside the last hour and drops older ones", () => {
    const rows = [snap(2, 10), snap(0.5, 12), snap(0, 15)];
    const inWindow = filterSnapshotsInRange(rows, "1H", NOW);
    assert.deepEqual(
      inWindow.map((row) => row.totalUsd),
      [12, 15],
    );
  });

  it("buckets 1D to hourly and ALL to daily", () => {
    const hourly = [
      snap(2, 10),
      {wallet: WALLET, capturedAt: NOW - 2 * 3_600_000 + 10_000, totalUsd: 11},
      snap(0, 20),
    ];
    const day = bucketSnapshots(hourly, "1D");
    assert.equal(day.length, 2);
    assert.equal(day[0]?.totalUsd, 11);

    const daily = [
      snap(48, 5),
      {wallet: WALLET, capturedAt: NOW - 48 * 3_600_000 + 60_000, totalUsd: 6},
      snap(0, 9),
    ];
    const all = bucketSnapshots(daily, "ALL");
    assert.equal(all.length, 2);
    assert.equal(all[0]?.totalUsd, 6);
  });
});

describe("portfolio snapshot dedupe", () => {
  it("writes the first row and skips another inside the hour", () => {
    assert.equal(shouldWriteSnapshot(null, NOW), true);
    assert.equal(shouldWriteSnapshot(NOW - 5 * 60_000, NOW), false);
    assert.equal(shouldWriteSnapshot(NOW - SNAPSHOT_INTERVAL_MS, NOW), true);
    assert.equal(shouldWriteSnapshot(NOW - SNAPSHOT_INTERVAL_MS - 1, NOW), true);
  });

  it("floors captured time to a UTC hour bucket", () => {
    assert.equal(hourBucketUtc(Date.parse("2026-09-06T12:47:11.500Z")), "2026-09-06T12:00:00.000Z");
  });

  it("normalizes wallets and drops junk", () => {
    assert.deepEqual(
      snapshotWallets([
        "0xAAA0000000000000000000000000000000000001",
        "not-a-wallet",
        "0xaaa0000000000000000000000000000000000001",
        "0xBBB0000000000000000000000000000000000002",
      ]),
      [
        "0xaaa0000000000000000000000000000000000001",
        "0xbbb0000000000000000000000000000000000002",
      ],
    );
  });
});

describe("empty wallet equity", () => {
  it("does not invent an uptrend when there is no history", () => {
    assert.deepEqual(chartPointsFromSnapshots([], null), []);
    assert.deepEqual(chartPointsFromSnapshots([], {t: NOW, totalUsd: 0}), [
      {t: NOW, price: 0},
    ]);
    const change = changeFromPoints([], 0);
    assert.equal(change.changeUsd, 0);
    assert.equal(change.changePct, 0);
  });

  it("draws a flat zero start from a real zero snapshot plus live", () => {
    const points = chartPointsFromSnapshots([snap(1, 0)], {t: NOW, totalUsd: 0});
    assert.equal(points.length, 2);
    assert.deepEqual(
      points.map((point) => point.price),
      [0, 0],
    );
    assert.ok((points[1]?.t ?? 0) > (points[0]?.t ?? 0));
  });

  it("rises only when a later real value is higher", () => {
    const points = chartPointsFromSnapshots(
      [snap(24, 10), snap(0, 10)],
      {t: NOW + 30_000, totalUsd: 18},
    );
    assert.deepEqual(
      points.map((point) => point.price),
      [10, 10, 18],
    );
    const change = changeFromPoints(points, 18);
    assert.equal(change.openValue, 10);
    assert.equal(change.changeUsd, 8);
  });
});
