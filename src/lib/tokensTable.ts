import {marketCapAt} from "./marketCap";
import type {TokenAsset} from "./types";

/**
 * The desktop Tokens table's shared vocabulary: tabs, sorts, pages, and the
 * few rules that decide what a click does. Kept pure so it can be tested.
 */

export const TOKENS_PAGE_SIZE = 50;

export const TOKENS_TABS = ["trending", "new", "following", "watchlist"] as const;
export type TokensTab = (typeof TOKENS_TABS)[number];

/** Sortable columns, plus Following's "newest trade first". */
export type TokensSort = "age" | "mcap" | "change" | "liq" | "vol" | "txns" | "recent";
export type TokensColumnSort = Exclude<TokensSort, "recent">;

export interface TokensOrder {
  sort: TokensSort;
  desc: boolean;
}

/** What each tab opens on. New's "newest first" is age, high to low. */
export const DEFAULT_ORDER: Record<TokensTab, TokensOrder> = {
  trending: {sort: "vol", desc: true},
  new: {sort: "age", desc: true},
  following: {sort: "recent", desc: true},
  watchlist: {sort: "vol", desc: true},
};

/**
 * A column title click: a new column sorts high to low, the same column flips.
 * Age "high to low" is newest first, since its value is the listing time.
 */
export function nextOrder(current: TokensOrder, column: TokensColumnSort): TokensOrder {
  if (current.sort === column) return {sort: column, desc: !current.desc};
  return {sort: column, desc: true};
}

/**
 * Where the next page starts. Keyset (`k` the last row's value as exact text,
 * `a` its address, `n` once past every row with a value) or, for sorts done in
 * memory, an offset.
 */
export type TokensCursor = {k: string | null; a: string; n: boolean} | {o: number};

export interface TokensTableRow {
  asset: TokenAsset;
  /** DexScreener's 24h counts; null = no data, shown as "—". */
  buys: number | null;
  sells: number | null;
  /** Following: the newest HODL trade by someone you follow. */
  tradedAt: string | null;
}

export interface TokensPage {
  rows: TokensTableRow[];
  next: TokensCursor | null;
  /** First page only: "Paired with" chips, most tokens first. */
  pairs?: {ticker: string; count: number}[];
  /**
   * A quick stand-in while the real page builds (the default order only, a
   * short list with no further pages): the client asks again soon.
   */
  partial?: boolean;
}

const positive = (value: number | null | undefined): number | null =>
  value != null && Number.isFinite(value) && value > 0 ? value : null;

/**
 * The number a column shows for a row, as a number: what a sort must compare.
 * Null when the cell shows "—", so missing values can go last. Mirrors the
 * row's own formatting (market cap is supply × the shown price, a young
 * token's 24h is its move since launch, zero volume or liquidity is "—").
 */
export function sortValue(row: TokensTableRow, sort: TokensColumnSort, asset: TokenAsset = row.asset): number | null {
  switch (sort) {
    case "age": {
      const listed = asset.listedAt ?? asset.createdAt;
      const t = listed ? Date.parse(listed) : NaN;
      return Number.isFinite(t) ? t : null;
    }
    case "mcap": {
      const price = positive(asset.priceUsd);
      return price == null ? null : positive(marketCapAt(asset, price));
    }
    case "change":
      return Number.isFinite(asset.changePct) ? asset.changePct : null;
    case "liq":
      return positive(asset.liquidityUsd);
    case "vol":
      return positive(asset.volume24hUsd);
    case "txns":
      return row.buys == null && row.sells == null ? null : (row.buys ?? 0) + (row.sells ?? 0);
  }
}

/**
 * Rows in column order by the values they show: high to low or low to high,
 * rows with no value always last, ties kept in the order they came.
 */
export function sortRows<T extends TokensTableRow>(
  rows: readonly T[],
  order: TokensOrder,
  view: (asset: TokenAsset) => TokenAsset = (asset) => asset,
): T[] {
  if (order.sort === "recent") return [...rows];
  const sort = order.sort;
  return rows
    .map((row, index) => ({row, index, value: sortValue(row, sort, view(row.asset))}))
    .sort((a, b) => {
      if (a.value == null || b.value == null) {
        if (a.value == null && b.value == null) return a.index - b.index;
        return a.value == null ? 1 : -1;
      }
      const diff = order.desc ? b.value - a.value : a.value - b.value;
      return diff || a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function encodeCursor(cursor: TokensCursor | null): string | null {
  return cursor ? JSON.stringify(cursor) : null;
}

export function decodeCursor(value: unknown): TokensCursor | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.o === "number" && raw.o >= 0) return {o: Math.floor(raw.o)};
  if (typeof raw.a === "string" && /^0x[0-9a-fA-F]{40}$/.test(raw.a)) {
    return {
      k: typeof raw.k === "string" ? raw.k.slice(0, 64) : null,
      a: raw.a.toLowerCase(),
      n: raw.n === true,
    };
  }
  return null;
}

export function parseTab(value: unknown): TokensTab {
  return TOKENS_TABS.includes(value as TokensTab) ? (value as TokensTab) : "trending";
}

export function parseSort(value: unknown, tab: TokensTab): TokensSort {
  const sorts: TokensSort[] = ["age", "mcap", "change", "liq", "vol", "txns", "recent"];
  if (!sorts.includes(value as TokensSort)) return DEFAULT_ORDER[tab].sort;
  // Only Following knows when a token was last traded by someone you follow.
  if (value === "recent" && tab !== "following") return DEFAULT_ORDER[tab].sort;
  return value as TokensSort;
}

/** "1,842" — buys and sells as whole numbers, or "—" when there is no count. */
export function countLabel(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : Math.round(value).toLocaleString("en-US");
}

/**
 * Rows while someone is reading: new values for the rows already on screen,
 * in the order they were, plus any rows a new page appended — never a reshuffle
 * under the cursor. Rows gone from the latest data keep their last values.
 */
export function stableRows<T extends {asset: {address: string}}>(
  shown: T[],
  latest: T[],
  frozen: boolean,
): T[] {
  if (!frozen || shown.length === 0) return latest;
  const byAddress = new Map(latest.map((row) => [row.asset.address.toLowerCase(), row]));
  const kept = shown.map((row) => byAddress.get(row.asset.address.toLowerCase()) ?? row);
  const onScreen = new Set(shown.map((row) => row.asset.address.toLowerCase()));
  // A page loaded by scrolling lands after what is on screen, in its own order.
  const appended = latest.filter((row) => !onScreen.has(row.asset.address.toLowerCase()));
  return [...kept, ...appended];
}
