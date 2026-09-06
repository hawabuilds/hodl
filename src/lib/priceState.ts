import {MIN_LIQUIDITY_USD} from "@/config/liquidity";
import {compactMoney, price as fmtPrice} from "@/lib/format";
import {marketCapAt} from "@/lib/marketCap";
import {applyThreeStateFilter} from "@/lib/threeState";
import type {Asset} from "@/lib/types";

/**
 * Three states that must never be collapsed into "$0":
 *   priced  — we have a live USD price
 *   unpriced — no price yet (show "—", keep the row, decorate it)
 *   dust    — measured liquidity below the floor (hide from feeds)
 */

export function isPriced(
  priceUsd: number | null | undefined,
): priceUsd is number {
  return typeof priceUsd === "number" && Number.isFinite(priceUsd) && priceUsd > 0;
}

/**
 * A measured market cap. Null last_mcap is "we have not priced it", not zero.
 * Never use `last_mcap != null` alone.
 */
export function isMeasuredMcap(stat: {
  priced_at?: string | null;
  last_mcap?: number | null;
} | null | undefined): boolean {
  if (!stat || stat.priced_at == null) return false;
  const mcap = stat.last_mcap;
  return mcap != null && Number.isFinite(Number(mcap)) && Number(mcap) > 0;
}

export type PriceStatus = "priced" | "no_pool" | "failed";

export function isUnpriceableStatus(
  status: string | null | undefined,
): boolean {
  return status === "no_pool" || status === "failed";
}

/** Cron / backfill: skip priced and evaluated no_pool/failed. */
export function needsPriceAttempt(stat: {
  priced_at?: string | null;
  price_status?: string | null;
} | null | undefined): boolean {
  if (isUnpriceableStatus(stat?.price_status)) return false;
  return stat?.priced_at == null;
}

/**
 * New hides unpriced rows. Coverage was reported at 41.4% of listed
 * universe before this flip (13,544 / 32,676).
 */
export const REQUIRE_MEASURED_MCAP_ON_NEW = true;
export const NEW_MCAP_COVERAGE_GATE = 0.9;

/** New requires a measured cap. no_pool / failed never show. */
export function showsOnNew(
  stat: {
    priced_at?: string | null;
    last_mcap?: number | null;
    price_status?: string | null;
  } | null | undefined,
  opts?: {requireMeasured?: boolean},
): boolean {
  if (isUnpriceableStatus(stat?.price_status)) return false;
  if (opts?.requireMeasured || REQUIRE_MEASURED_MCAP_ON_NEW) {
    return isMeasuredMcap(stat);
  }
  return true;
}

/**
 * Measured cap: priced_at present and last_mcap > 0.
 * `.gt("last_mcap", 0)` drops null mcap — do not add a separate null check.
 */
export function applyMeasuredMcapFilter<T>(
  request: T,
  columnPrefix = "",
): T {
  const pricedAt = columnPrefix ? `${columnPrefix}.priced_at` : "priced_at";
  const mcap = columnPrefix ? `${columnPrefix}.last_mcap` : "last_mcap";
  let next = request as T & {
    not: (column: string, op: string, value: string) => T;
    gt: (column: string, value: number) => T;
  };
  next = next.not(pricedAt, "is", "null") as typeof next;
  next = next.gt(mcap, 0) as typeof next;
  return next;
}

export function isTradeableFromLiquidity(
  liquidityUsd: number | null | undefined,
  floorUsd = MIN_LIQUIDITY_USD,
): boolean | null {
  if (liquidityUsd == null || !Number.isFinite(liquidityUsd)) return null;
  return liquidityUsd >= floorUsd;
}

/** True when the user set an explicit numeric min and/or max. Zero is not a bound. */
export function isUserBound(
  min?: number | null,
  max?: number | null,
): boolean {
  return (min != null && min > 0) || (max != null && max > 0);
}

/**
 * Explicit filter bounds. Null / non-finite cannot satisfy a set min or max.
 * No bound → pass (including null). Does not coalesce null to zero.
 */
export function meetsBound(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
): boolean {
  const bounded = isUserBound(min, max);
  if (!bounded) return true;
  if (value == null || !Number.isFinite(value)) return false;
  if (min != null && min > 0 && value < min) return false;
  if (max != null && max > 0 && value > max) return false;
  return true;
}

/**
 * PostgREST `.gte` / `.lte`. Equivalent to `col >= min` (nulls drop).
 * Never emit a standalone `IS NOT NULL`.
 */
export function applyNumericBounds<T>(
  request: T,
  column: string,
  min?: number | null,
  max?: number | null,
): T {
  let next = request as T & {
    gte: (column: string, value: number) => T;
    lte: (column: string, value: number) => T;
  };
  if (min != null && min > 0) next = next.gte(column, min) as typeof next;
  if (max != null && max > 0) next = next.lte(column, max) as typeof next;
  return next;
}

const MS_PER_HOUR = 3_600_000;

/** Hours since `createdAt`. Null / unparseable cannot satisfy an age bound. */
export function ageHoursSince(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (createdAt == null || createdAt === "") return null;
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  return (now - ms) / MS_PER_HOUR;
}

/**
 * Age in hours since `created_at` (same field as client `token.createdAt`).
 * minAgeHours = N → `created_at <= now - N hours` (at least N hours old).
 * maxAgeHours = N → `created_at >= now - N hours` (at most N hours old).
 * `.lte` / `.gte` drop null created_at. Never a standalone IS NOT NULL.
 */
export function applyAgeBounds<T>(
  request: T,
  minAgeHours?: number | null,
  maxAgeHours?: number | null,
  now: number = Date.now(),
  column = "created_at",
): T {
  let next = request as T & {
    gte: (column: string, value: string) => T;
    lte: (column: string, value: string) => T;
  };
  if (minAgeHours != null && minAgeHours > 0) {
    next = next.lte(
      column,
      new Date(now - minAgeHours * MS_PER_HOUR).toISOString(),
    ) as typeof next;
  }
  if (maxAgeHours != null && maxAgeHours > 0) {
    next = next.gte(
      column,
      new Date(now - maxAgeHours * MS_PER_HOUR).toISOString(),
    ) as typeof next;
  }
  return next;
}

/**
 * User min liquidity → `.gte("liquidity_usd", floor)` (nulls excluded).
 * No user min → three-state `is_tradeable` (unmeasured still show).
 * Max, when set, is `.lte` so null cannot satisfy it.
 */
export function applyLiquidityBoundFilter<T>(
  request: T,
  minLiquidity?: number | null,
  maxLiquidity?: number | null,
): T {
  const userMin = minLiquidity != null && minLiquidity > 0;
  let next = applyNumericBounds(request, "liquidity_usd", minLiquidity, maxLiquidity);
  if (!userMin) {
    next = applyThreeStateFilter(next, "is_tradeable");
  }
  return next;
}

/** Shared New / Trending predicate after a page is fetched. */
export function rowPassesMarketBounds(opts: {
  mcap: number | null | undefined;
  liq: number | null | undefined;
  tradeable?: boolean | null;
  minMarketCap?: number | null;
  maxMarketCap?: number | null;
  minLiquidity?: number | null;
  maxLiquidity?: number | null;
  defaultLiqFloor?: number;
}): boolean {
  if (opts.tradeable === false) return false;
  if (!meetsBound(opts.mcap, opts.minMarketCap ?? null, opts.maxMarketCap ?? null)) {
    return false;
  }
  if (isUserBound(opts.minLiquidity, opts.maxLiquidity)) {
    return meetsBound(opts.liq, opts.minLiquidity ?? null, opts.maxLiquidity ?? null);
  }
  const floor = opts.defaultLiqFloor ?? MIN_LIQUIDITY_USD;
  if (opts.liq != null && Number.isFinite(Number(opts.liq)) && Number(opts.liq) < floor) {
    return false;
  }
  return true;
}

export type FeedBoundOpts = Parameters<typeof rowPassesMarketBounds>[0] & {
  /** 24h USD volume (`vol_24h`). Window is display/sort only. */
  volume?: number | null | undefined;
  createdAt?: string | null;
  ageHours?: number | null;
  now?: number;
  minVolume?: number | null;
  maxVolume?: number | null;
  minAgeHours?: number | null;
  maxAgeHours?: number | null;
};

/**
 * Market bounds plus volume (`vol_24h`) and age (`created_at`).
 * A set numeric bound requires a measured value — null cannot pass.
 */
export function rowPassesFeedBounds(opts: FeedBoundOpts): boolean {
  if (!rowPassesMarketBounds(opts)) return false;
  if (!meetsBound(opts.volume, opts.minVolume ?? null, opts.maxVolume ?? null)) {
    return false;
  }
  const age =
    opts.ageHours != null && Number.isFinite(opts.ageHours)
      ? opts.ageHours
      : ageHoursSince(opts.createdAt, opts.now ?? Date.now());
  return meetsBound(age, opts.minAgeHours ?? null, opts.maxAgeHours ?? null);
}

/** Market cap / price / liq for the UI. Never prints "$0" for an unknown. */
export function formatMarketCapUsd(
  value: number | null | undefined,
  priced: boolean,
): string {
  if (!priced || value == null || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  if (value < 0.01) return "<$0.01";
  return compactMoney(value);
}

export function formatPriceUsd(value: number | null | undefined): string {
  if (!isPriced(value)) return "—";
  return fmtPrice(value as number);
}

export function formatLiquidityUsd(value: number | null | undefined): string {
  return formatUsdStat(value);
}

/** 24h volume. Missing or zero is unmeasured, not "$0". */
export function formatVolumeUsd(value: number | null | undefined): string {
  return formatUsdStat(value);
}

/**
 * Live 24h volume for browse lists. Null / non-finite / zero all mean
 * "no trades in the window" — hide from home, New, trending, market cap,
 * and rewards. Search does not use this.
 */
export function hasVolume24h(volume: number | null | undefined): boolean {
  return volume != null && Number.isFinite(Number(volume)) && Number(volume) > 0;
}

/** Browse-list volume gate. Same as `hasVolume24h`. Search must not call this. */
export function showsWithVolume24h(
  volume: number | null | undefined,
): boolean {
  return hasVolume24h(volume);
}

/**
 * PostgREST: `vol_24h > 0` on one table (or `token_stats.vol_24h` via embed).
 * `.gt` drops null — that is the hide. Never emit a standalone IS NOT NULL.
 *
 * Do not put `token_stats.vol_24h` inside `.or()` with `listed_at`. PostgREST
 * cannot parse that cross-table OR and `/api/tokens/new` 503s.
 */
export function applyLiveVolumeFilter<T>(
  request: T,
  opts?: {columnPrefix?: string},
): T {
  const col = opts?.columnPrefix ? `${opts.columnPrefix}.vol_24h` : "vol_24h";
  return (request as T & {gt: (column: string, value: number) => T}).gt(
    col,
    0,
  ) as T;
}

/** Fresh listings: `listed_at >= since`. Same-table `.gte`, not an `.or()`. */
export function applyListedSinceFilter<T>(request: T, since: string): T {
  return (request as T & {gte: (column: string, value: string) => T}).gte(
    "listed_at",
    since,
  ) as T;
}

/** Newest `listed_at` first, one row per address. */
export function mergeNewestListed<T extends {address: string; listed_at?: string | null}>(
  rows: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const key = row.address.toLowerCase();
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()].sort((a, b) => {
    const listed = (b.listed_at ?? "").localeCompare(a.listed_at ?? "");
    if (listed !== 0) return listed;
    return b.address.toLowerCase().localeCompare(a.address.toLowerCase());
  });
}

function formatUsdStat(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value < 0.01) return "<$0.01";
  return compactMoney(value);
}

/** Cap at the price this surface is showing. Unpriced never prints "$0". */
export function formatMarketCapAt(
  asset: Asset,
  priceUsd: number | null | undefined,
): string {
  if (!isPriced(priceUsd)) return "—";
  return formatMarketCapUsd(marketCapAt(asset, priceUsd), true);
}
