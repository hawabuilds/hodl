import {DUST_USD} from "@/config/fees";
import type {Holding} from "./types";

/**
 * Portfolio allocation: what each position weighs, how far it is from the
 * owner's target, and how to spread fresh money toward those targets.
 *
 * The weights, targets and drift maths are Trador's, ported to HODL's
 * holdings. One deliberate difference: a leg here is sized in dollars only,
 * because HODL's quotes take a dollar amount. (Trador sized buys in the
 * bought token's units and then quoted them as the pay amount, which made
 * buy legs the wrong size.)
 *
 * A holding is keyed `kind:assetId` — `token:0x…` or `rwa:nvda` — the same
 * key a target is saved under.
 */

export type AllocationKey = string;

export interface WeightSlice {
  readonly key: AllocationKey;
  readonly symbol: string;
  readonly valueUsd: number;
  /** Percent of the priced portfolio, 0–100. */
  readonly weight: number;
  readonly holding: Holding;
}

export interface DriftSlice extends WeightSlice {
  readonly target: number;
  /** Actual minus target, in percentage points. */
  readonly deltaPct: number;
  /** Dollars to add (positive) or take away (negative) to reach target. */
  readonly deltaUsd: number;
}

export interface GroupedSlice extends WeightSlice {
  /** The small holdings folded into "Other". */
  readonly grouped?: readonly WeightSlice[];
}

/** A planned buy: dollars toward one underweight holding. */
export interface TopUpLeg {
  readonly key: AllocationKey;
  readonly holding: Holding;
  readonly amountUsd: number;
  /** Under the router's $1 minimum: shown, never sent. */
  readonly belowMinimum: boolean;
}

/** Targets may be off by this many points in total and still count as 100%. */
const TARGET_SUM_TOLERANCE = 0.1;

/** Slices under this weight fold into "Other" in the chart. */
export const OTHER_BELOW_PCT = 2;

/** A drift this large (points, on any holding) shows the Rebalance button. */
export const REBALANCE_THRESHOLD_PCT = 2;

export const OTHER_KEY = "__other__";

export function allocationKey(holding: Pick<Holding, "kind" | "assetId">): AllocationKey {
  return `${holding.kind}:${holding.assetId.toLowerCase()}`;
}

/** Holdings with a known, positive value — the only ones that belong in a pie. */
export function pricedHoldings(holdings: readonly Holding[]): Holding[] {
  return holdings.filter((holding) => Number.isFinite(holding.valueUsd) && holding.valueUsd > 0);
}

/** Actual weights of the priced holdings, largest first. */
export function actualWeights(holdings: readonly Holding[]): WeightSlice[] {
  const priced = pricedHoldings(holdings);
  const total = priced.reduce((sum, holding) => sum + holding.valueUsd, 0);
  if (total <= 0) return [];
  return priced
    .map((holding) => ({
      key: allocationKey(holding),
      symbol: holding.symbol,
      valueUsd: holding.valueUsd,
      weight: (holding.valueUsd / total) * 100,
      holding,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

/**
 * Targets for exactly these holdings, scaled to sum to 100. Unknown keys are
 * dropped; a holding without one counts as zero before scaling.
 */
export function normalizeTargets(
  targets: Record<string, number>,
  keys: readonly AllocationKey[],
): Record<string, number> {
  const picked: Record<string, number> = {};
  let sum = 0;
  for (const key of keys) {
    const value = Number(targets[key]);
    const weight = Number.isFinite(value) && value >= 0 ? value : 0;
    picked[key] = weight;
    sum += weight;
  }
  if (sum <= 0) {
    const even = keys.length > 0 ? 100 / keys.length : 0;
    return Object.fromEntries(keys.map((key) => [key, even]));
  }
  if (Math.abs(sum - 100) <= TARGET_SUM_TOLERANCE) return picked;
  const scale = 100 / sum;
  return Object.fromEntries(keys.map((key) => [key, picked[key] * scale]));
}

export function targetsValid(targets: Record<string, number>): boolean {
  const values = Object.values(targets);
  if (values.length === 0) return false;
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return false;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 100) <= TARGET_SUM_TOLERANCE;
}

/** Each priced holding against its target. */
export function drift(holdings: readonly Holding[], targets: Record<string, number>): DriftSlice[] {
  const slices = actualWeights(holdings);
  const total = slices.reduce((sum, slice) => sum + slice.valueUsd, 0);
  return slices.map((slice) => {
    const target = targets[slice.key] ?? 0;
    const targetUsd = (target / 100) * total;
    return {...slice, target, deltaPct: slice.weight - target, deltaUsd: targetUsd - slice.valueUsd};
  });
}

/** The largest distance from target, in percentage points. */
export function rebalanceScore(rows: readonly DriftSlice[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((row) => Math.abs(row.deltaPct)));
}

/**
 * Fresh money spread across the underweight holdings, in proportion to how
 * far each is below target. Nothing is sold. Largest first.
 */
export function planTopUp(
  holdings: readonly Holding[],
  targets: Record<string, number>,
  amountUsd: number,
): TopUpLeg[] {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return [];
  const rows = drift(holdings, targets).filter((row) => row.deltaUsd > 0);
  const deficit = rows.reduce((sum, row) => sum + row.deltaUsd, 0);
  if (deficit <= 0) return [];
  return rows
    .map((row) => {
      const legUsd = Math.round((row.deltaUsd / deficit) * amountUsd * 100) / 100;
      return {key: row.key, holding: row.holding, amountUsd: legUsd, belowMinimum: legUsd < DUST_USD};
    })
    .filter((leg) => leg.amountUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd);
}

/** Small slices folded into one "Other" slice, for the chart and its legend. */
export function groupSmallSlices(
  slices: readonly WeightSlice[],
  minWeight = OTHER_BELOW_PCT,
): GroupedSlice[] {
  const large: GroupedSlice[] = [];
  const small: WeightSlice[] = [];
  for (const slice of slices) {
    if (slice.weight >= minWeight) large.push(slice);
    else small.push(slice);
  }
  if (small.length === 0) return large;
  // One small slice on its own is itself, not "Other".
  if (small.length === 1) return [...large, small[0]];
  return [
    ...large,
    {
      key: OTHER_KEY,
      symbol: "Other",
      valueUsd: small.reduce((sum, slice) => sum + slice.valueUsd, 0),
      weight: small.reduce((sum, slice) => sum + slice.weight, 0),
      holding: small[0].holding,
      grouped: small,
    },
  ];
}

/** Targets seeded from today's weights, one decimal, summing to 100. */
export function targetsFromActual(holdings: readonly Holding[]): Record<string, number> {
  const rounded = actualWeights(holdings).map((slice) => ({
    key: slice.key,
    weight: Math.round(slice.weight * 10) / 10,
  }));
  if (rounded.length === 0) return {};
  const sum = rounded.reduce((total, row) => total + row.weight, 0);
  // The rounding remainder goes on the largest, so no weight goes negative.
  rounded[0].weight = Math.round((rounded[0].weight + (100 - sum)) * 10) / 10;
  return Object.fromEntries(rounded.map((row) => [row.key, row.weight]));
}

/** The same weight for every holding, summing to 100. */
export function equalTargets(keys: readonly AllocationKey[]): Record<string, number> {
  if (keys.length === 0) return {};
  const each = Math.round((100 / keys.length) * 10) / 10;
  const result: Record<string, number> = {};
  for (const key of keys) result[key] = each;
  result[keys[0]] = Math.round((result[keys[0]] + (100 - each * keys.length)) * 10) / 10;
  return result;
}

/** A target map as saved: known key shapes, weights 0–100, at most 300 entries. */
export function cleanTargets(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 300) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of entries) {
    if (!/^(token:0x[0-9a-f]{40}|rwa:[a-z0-9.]{1,12})$/.test(key)) return null;
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) return null;
    out[key] = Math.round(weight * 100) / 100;
  }
  return out;
}

/**
 * Dollars of ETH that can go into buys: the balance less gas for each buy
 * still to send (with a 20% cushion, the same margin the swap path checks).
 */
export function spendableEthUsd(opts: {
  balanceWei: bigint;
  gasPriceWei: bigint;
  buys: number;
  ethUsd: number;
  swapGasUnits: bigint;
}): number {
  if (!(opts.ethUsd > 0) || opts.buys < 0) return 0;
  const reserve = (opts.swapGasUnits * opts.gasPriceWei * BigInt(Math.max(1, opts.buys)) * 12n) / 10n;
  const free = opts.balanceWei - reserve;
  if (free <= 0n) return 0;
  return Math.floor((Number(free) / 1e18) * opts.ethUsd * 100) / 100;
}
