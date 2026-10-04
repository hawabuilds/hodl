import type {Holding, PortfolioPnl, PriceState} from "./types";
import type {PortfolioCache} from "./localStore";

/**
 * The portfolio page's rows: every holding plus the wallet's cash, ETH and
 * USDG, which are holdings too (tagged "Cash") and count toward the totals,
 * the filters and the donut. USDG shows as "USD", valued at $1.00.
 *
 * Shares are rounded to one decimal by largest remainder, so the shown
 * percentages always add up to exactly 100.0, in the table, the legend and
 * the donut alike.
 */

export type RowKind = "token" | "rwa" | "cash";

export interface PortfolioRow {
  key: string;
  kind: RowKind;
  /** The token or RWA, or null for a cash row (ETH, USDG). */
  holding: Holding | null;
  symbol: string;
  name: string;
  amount: number;
  /** The unit the amount is shown in, when not the symbol: "USDG" under "USD". */
  unit?: string;
  valueUsd: number;
  /** Null when there is no basis to measure from (and always for ETH). */
  pnlUsd: number | null;
  pnlPct: number | null;
  /** Percent of everything held, ETH included, one decimal. */
  share: number;
  /**
   * "pending" rows have no price yet: their value, P&L and share are not
   * known and must not be shown as numbers. "stale" rows carry the last known
   * price.
   */
  priceState: PriceState;
  /** For a stale price: when it was seen (ISO). */
  priceAt: string | null;
  color: string;
}

export interface DonutSlice {
  key: string;
  label: string;
  valueUsd: number;
  share: number;
  color: string;
  /** How many holdings an "Others" slice stands for. */
  count?: number;
}

/** Distinct hues, one per holding, in value order. ETH has its own. */
export const HOLDING_COLORS = [
  "var(--brand-500)",
  "#2FD3A0",
  "#F5A524",
  "#4DA8FF",
  "#F472B6",
  "#B794F6",
  "#22C7D6",
] as const;
export const CASH_COLOR = "#8E93B8";
/** USD cash: a lighter grey than ETH, so the two never read as one slice. */
export const USD_COLOR = "#C9CCE6";
export const OTHERS_COLOR = "#565B74";

/** Slices in the donut before the rest fold into "Others". */
export const DONUT_SLICES = 6;

export const ETH_KEY = "cash:eth";
export const USDG_KEY = "cash:usdg";

export function buildRows(
  holdings: readonly Holding[],
  ethBalance: number,
  ethValueUsd: number,
  /** True while the ETH price is not in. */
  ethPending = false,
  usdgBalance = 0,
): PortfolioRow[] {
  const rows: Omit<PortfolioRow, "share" | "color">[] = holdings.map((holding) => {
    const priceState = holding.priceState ?? "live";
    const pending = priceState === "pending";
    // A missing price is not a price of zero: no value, no P&L, no share.
    const value = !pending && Number.isFinite(holding.valueUsd) ? holding.valueUsd : 0;
    const basis = holding.costUsd;
    const pnlUsd = pending || basis == null || !Number.isFinite(basis) ? null : value - basis;
    return {
      key: `${holding.kind}:${holding.assetId.toLowerCase()}`,
      kind: holding.kind,
      holding,
      symbol: holding.symbol,
      name: holding.name,
      amount: holding.amount,
      valueUsd: value,
      pnlUsd,
      pnlPct: pnlUsd != null && basis != null && basis > 0 ? (pnlUsd / basis) * 100 : null,
      priceState,
      priceAt: holding.priceAt ?? null,
    };
  });
  if (ethBalance > 0) {
    rows.push({
      key: ETH_KEY,
      kind: "cash",
      holding: null,
      symbol: "ETH",
      name: "Ether",
      amount: ethBalance,
      valueUsd: !ethPending && Number.isFinite(ethValueUsd) ? ethValueUsd : 0,
      pnlUsd: null,
      pnlPct: null,
      priceState: ethPending ? "pending" : "live",
      priceAt: null,
    });
  }
  if (usdgBalance > 0) {
    rows.push({
      key: USDG_KEY,
      kind: "cash",
      holding: null,
      symbol: "USD",
      name: "USDG",
      unit: "USDG",
      amount: usdgBalance,
      valueUsd: usdgBalance,
      pnlUsd: null,
      pnlPct: null,
      priceState: "live",
      priceAt: null,
    });
  }
  rows.sort((a, b) => b.valueUsd - a.valueUsd);

  const shares = roundedShares(rows.map((row) => row.valueUsd));
  // Colours follow the donut: its slices get a hue each, and whatever folds
  // into "Others" shares that slice's grey, so a bar always matches its slice.
  const inDonut = new Set(donutMembers(rows.map((row) => row.key)));
  let hue = 0;
  return rows.map((row, index) => ({
    ...row,
    share: shares[index],
    color: !inDonut.has(row.key)
      ? OTHERS_COLOR
      : row.key === USDG_KEY
        ? USD_COLOR
        : row.kind === "cash"
          ? CASH_COLOR
          : HOLDING_COLORS[hue++ % HOLDING_COLORS.length],
  }));
}

/**
 * Which rows get their own slice. Six, and the rest as "Others" — unless the
 * rest is a single holding, which then simply shows as itself.
 */
function donutMembers(keys: readonly string[]): string[] {
  return keys.length <= DONUT_SLICES + 1 ? [...keys] : keys.slice(0, DONUT_SLICES);
}

export function donutSlices(rows: readonly PortfolioRow[]): DonutSlice[] {
  const valued = rows.filter((row) => row.valueUsd > 0);
  const members = new Set(donutMembers(valued.map((row) => row.key)));
  const slices: DonutSlice[] = valued
    .filter((row) => members.has(row.key))
    .map((row) => ({key: row.key, label: row.symbol, valueUsd: row.valueUsd, share: row.share, color: row.color}));
  const rest = valued.filter((row) => !members.has(row.key));
  if (rest.length > 0) {
    slices.push({
      key: "others",
      label: "Others",
      valueUsd: rest.reduce((sum, row) => sum + row.valueUsd, 0),
      share: Math.round(rest.reduce((sum, row) => sum + row.share, 0) * 10) / 10,
      color: OTHERS_COLOR,
      count: rest.length,
    });
  }
  return slices;
}

/** Shares of the total in tenths of a percent that sum to exactly 100.0. */
export function roundedShares(values: readonly number[]): number[] {
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = clean.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return clean.map(() => 0);
  const exact = clean.map((value) => (value / total) * 1000);
  const floors = exact.map(Math.floor);
  let left = 1000 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({index, remainder: value - floors[index]}))
    .sort((a, b) => b.remainder - a.remainder);
  for (const {index} of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors.map((tenths) => tenths / 10);
}

/** Profit since the first saved fill: open positions plus what was sold. */
export function totalPnl(
  rows: readonly PortfolioRow[],
  pnl: PortfolioPnl | null,
): {usd: number; pct: number | null} | null {
  const open = rows.filter((row) => row.pnlUsd != null);
  if (!pnl && open.length === 0) return null;
  const usd = open.reduce((sum, row) => sum + (row.pnlUsd ?? 0), 0) + (pnl?.realizedUsd ?? 0);
  const put = pnl?.boughtUsd ?? 0;
  return {usd, pct: put > 0 ? (usd / put) * 100 : null};
}

/** "1.25M", "820K", "12.5", "0.3178": compact, never cut off. */
export function compactAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return new Intl.NumberFormat("en-US", {notation: "compact", maximumSignificantDigits: 3}).format(value);
  }
  if (abs === 0) return "0";
  if (abs < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-US", {maximumSignificantDigits: 4}).format(value);
}

/** "+13.8%", "−4.8%", "0.0%": one decimal, a real minus sign. */
export function signedPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}%`;
}

/** "+$22.10", "−$11.40". */
export function signedUsd(value: number, money: (value: number) => string): string {
  const cents = Math.round(value * 100) / 100;
  if (cents === 0) return money(0);
  return `${cents > 0 ? "+" : "−"}${money(Math.abs(cents))}`;
}

/** A holding's price state; older payloads without one were always priced. */
export function priceStateOf(holding: Holding): NonNullable<Holding["priceState"]> {
  return holding.priceState ?? "live";
}

/**
 * Holdings still waiting on a price take the last price this device saw for
 * them, marked stale, rather than showing nothing — or worse, zero.
 */
export function withLastKnownPrices(holdings: Holding[], cache: Pick<PortfolioCache, "holdings" | "savedAt"> | null): Holding[] {
  if (!cache) return holdings;
  const last = new Map(cache.holdings.map((row) => [`${row.kind}:${row.assetId.toLowerCase()}`, row]));
  return holdings.map((row) => {
    if (priceStateOf(row) !== "pending") return row;
    const seen = last.get(`${row.kind}:${row.assetId.toLowerCase()}`);
    const state = seen ? priceStateOf(seen) : null;
    const price =
      seen && (state === "live" || state === "stale")
        ? (seen.priceUsd ?? (seen.amount > 0 ? seen.valueUsd / seen.amount : null))
        : null;
    if (price == null || !(price > 0)) return row;
    return {
      ...row,
      priceUsd: price,
      valueUsd: row.amount * price,
      priceState: "stale" as const,
      priceAt: seen?.priceAt ?? new Date(cache.savedAt).toISOString(),
    };
  });
}
