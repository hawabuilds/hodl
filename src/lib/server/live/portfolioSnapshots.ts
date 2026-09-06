import type {ChartPoint, PortfolioRange} from "@/lib/types";
import {PORTFOLIO_RANGES} from "@/lib/types";

export {PORTFOLIO_RANGES};
import {isAddress, normalizeAddress} from "@/lib/address";
import {db, hasDatabase} from "../db";

/**
 * Persisted portfolio equity.
 *
 * The profile chart used to reconstruct "what these holdings would have been
 * worth" from each token's price tape. That is a price chart in disguise: a
 * buy today is drawn as if the coins had been held all week, so the line
 * cannot follow cash-in. These rows are the signed-in wallet's total USD at
 * a point in time. Real snapshots only — never a seeded uptrend.
 */

export const SNAPSHOT_INTERVAL_MS = 60 * 60_000;

export const PORTFOLIO_RANGE_MS: Record<PortfolioRange, number | null> = {
  "1H": 60 * 60_000,
  "1D": 86_400_000,
  "1W": 7 * 86_400_000,
  "1M": 30 * 86_400_000,
  "1Y": 365 * 86_400_000,
  ALL: null,
};

/** How wide a bucket is when downsampling a dense hour series. */
export const PORTFOLIO_BUCKET_MS: Record<PortfolioRange, number> = {
  "1H": 5 * 60_000,
  "1D": 60 * 60_000,
  "1W": 4 * 60 * 60_000,
  "1M": 86_400_000,
  "1Y": 86_400_000,
  ALL: 86_400_000,
};

export interface EquitySnapshot {
  wallet: string;
  capturedAt: number;
  totalUsd: number;
}

export function parsePortfolioRange(value: string | null): PortfolioRange | null {
  return PORTFOLIO_RANGES.find((range) => range === value) ?? null;
}

/** Lowercase, 0x-checked, first-seen order. */
export function snapshotWallets(raw: string[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const address = normalizeAddress(value);
    if (!isAddress(address) || out.includes(address)) continue;
    out.push(address);
  }
  return out;
}

export function hourBucketUtc(at: number): string {
  const date = new Date(at);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function shouldWriteSnapshot(
  lastCapturedAt: number | null,
  now: number,
  intervalMs: number = SNAPSHOT_INTERVAL_MS,
): boolean {
  if (lastCapturedAt == null || !Number.isFinite(lastCapturedAt)) return true;
  return now - lastCapturedAt >= intervalMs;
}

export function filterSnapshotsInRange(
  rows: EquitySnapshot[],
  range: PortfolioRange,
  now: number,
): EquitySnapshot[] {
  const window = PORTFOLIO_RANGE_MS[range];
  if (window == null) return [...rows].sort((a, b) => a.capturedAt - b.capturedAt);
  const start = now - window;
  return rows
    .filter((row) => row.capturedAt >= start)
    .sort((a, b) => a.capturedAt - b.capturedAt);
}

/**
 * One point per bucket, latest sample wins. Two wallets snapshotted in the
 * same hour (same combined total) collapse to a single point.
 */
export function bucketSnapshots(
  rows: EquitySnapshot[],
  range: PortfolioRange,
): EquitySnapshot[] {
  if (rows.length === 0) return [];
  const bucketMs = PORTFOLIO_BUCKET_MS[range];
  const byBucket = new Map<number, EquitySnapshot>();
  for (const row of rows) {
    const key = Math.floor(row.capturedAt / bucketMs) * bucketMs;
    const prev = byBucket.get(key);
    if (!prev || row.capturedAt >= prev.capturedAt) byBucket.set(key, row);
  }
  return [...byBucket.values()].sort((a, b) => a.capturedAt - b.capturedAt);
}

/**
 * History plus the live tip. A single snapshot is not a line; the live
 * value is appended so a first visit can still draw a flat/zero start
 * instead of inventing a second historical point.
 */
export function chartPointsFromSnapshots(
  rows: EquitySnapshot[],
  live: {t: number; totalUsd: number} | null,
): ChartPoint[] {
  const points: ChartPoint[] = rows.map((row) => ({
    t: row.capturedAt,
    price: row.totalUsd,
  }));
  if (!live) return points;

  const last = points[points.length - 1];
  if (!last) {
    points.push({t: live.t, price: live.totalUsd});
    return points;
  }
  if (live.t - last.t < 1_000) {
    last.t = live.t;
    last.price = live.totalUsd;
    return points;
  }
  points.push({t: live.t, price: live.totalUsd});
  return points;
}

export function changeFromPoints(
  points: ChartPoint[],
  liveUsd: number,
): {openValue: number; changeUsd: number; changePct: number} {
  const openValue = points[0]?.price ?? liveUsd;
  const changeUsd = liveUsd - openValue;
  return {
    openValue,
    changeUsd,
    changePct: openValue > 0 ? (changeUsd / openValue) * 100 : 0,
  };
}

interface SnapshotRow {
  wallet: string;
  captured_at: string;
  total_usd: number | string;
}

function toSnapshot(row: SnapshotRow): EquitySnapshot {
  return {
    wallet: row.wallet,
    capturedAt: new Date(row.captured_at).getTime(),
    totalUsd: Number(row.total_usd),
  };
}

export async function latestSnapshotAt(
  wallets: string[],
): Promise<number | null> {
  if (!hasDatabase || wallets.length === 0) return null;
  const {data, error} = await db()
    .from("portfolio_snapshots")
    .select("captured_at")
    .in("wallet", wallets)
    .order("captured_at", {ascending: false})
    .limit(1)
    .maybeSingle();
  if (error || !data?.captured_at) return null;
  const at = new Date(data.captured_at as string).getTime();
  return Number.isFinite(at) ? at : null;
}

export async function maybeWritePortfolioSnapshot(input: {
  wallets: string[];
  totalUsd: number;
  positionsUsd: number;
  ethUsd: number;
  now?: number;
  degraded?: boolean;
}): Promise<{wrote: boolean; reason: string}> {
  const wallets = snapshotWallets(input.wallets);
  if (wallets.length === 0) return {wrote: false, reason: "no-wallet"};
  if (input.degraded) return {wrote: false, reason: "degraded"};
  if (!hasDatabase) return {wrote: false, reason: "no-database"};
  if (!Number.isFinite(input.totalUsd)) return {wrote: false, reason: "invalid-total"};

  const now = input.now ?? Date.now();
  const lastAt = await latestSnapshotAt(wallets);
  if (!shouldWriteSnapshot(lastAt, now)) {
    return {wrote: false, reason: "deduped"};
  }

  const hour = hourBucketUtc(now);
  const rows = wallets.map((wallet) => ({
    wallet,
    captured_at: new Date(now).toISOString(),
    hour_bucket: hour,
    total_usd: input.totalUsd,
    positions_usd: input.positionsUsd,
    eth_usd: input.ethUsd,
  }));

  const {error} = await db()
    .from("portfolio_snapshots")
    .upsert(rows, {onConflict: "wallet,hour_bucket"});
  if (error) {
    console.error("portfolio snapshot write failed", error.message);
    return {wrote: false, reason: "write-failed"};
  }
  return {wrote: true, reason: "ok"};
}

export async function loadPortfolioSnapshots(
  wallets: string[],
  range: PortfolioRange,
  now: number = Date.now(),
): Promise<EquitySnapshot[]> {
  if (!hasDatabase || wallets.length === 0) return [];

  const window = PORTFOLIO_RANGE_MS[range];
  const since =
    window == null ? null : new Date(now - window).toISOString();

  let query = db()
    .from("portfolio_snapshots")
    .select("wallet, captured_at, total_usd")
    .in("wallet", wallets)
    .order("captured_at", {ascending: false})
    .limit(5000);

  if (since) query = query.gte("captured_at", since);

  const {data, error} = await query;
  if (error || !data) {
    if (error) console.error("portfolio snapshot read failed", error.message);
    return [];
  }

  const rows = (data as SnapshotRow[])
    .map(toSnapshot)
    .sort((a, b) => a.capturedAt - b.capturedAt);

  return bucketSnapshots(filterSnapshotsInRange(rows, range, now), range);
}
