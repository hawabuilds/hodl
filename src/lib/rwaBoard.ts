import type {SectorId} from "./sectors";
import type {RwaSession} from "./rwaMove";

/**
 * The desktop RWAs page's shared vocabulary: categories, sorts, rows and the
 * rules that order them. Kept pure so it can be tested.
 */

export const RWAS_PAGE_SIZE = 50;

export const RWA_CATEGORIES = [
  {id: "tech", label: "Tech"},
  {id: "ai", label: "AI"},
  {id: "semis", label: "Semiconductors"},
  {id: "energy", label: "Energy"},
  {id: "health", label: "Healthcare"},
  {id: "consumer", label: "Consumer"},
  {id: "funds", label: "ETFs & Funds"},
  {id: "commodities", label: "Gold & Commodities"},
  {id: "space", label: "Space & Defense"},
  {id: "cryptofin", label: "Crypto & Finance"},
] as const;
export type RwaCategory = (typeof RWA_CATEGORIES)[number]["id"];

/** Funds that hold a commodity rather than companies. They are funds too. */
const COMMODITY_FUNDS = new Set(["GLD", "SLV", "USO"]);

const BY_SECTOR: Record<SectorId, RwaCategory> = {
  software: "tech",
  internet: "tech",
  quantum: "tech",
  ai: "ai",
  semis: "semis",
  energy: "energy",
  health: "health",
  consumer: "consumer",
  funds: "funds",
  space: "space",
  crypto: "cryptofin",
  finance: "cryptofin",
};

/** Every category a stock belongs to. Every sector maps somewhere, so never empty. */
export function categoriesFor(ticker: string, sector: SectorId): RwaCategory[] {
  const out: RwaCategory[] = [BY_SECTOR[sector]];
  if (COMMODITY_FUNDS.has(ticker)) out.push("commodities");
  return out;
}

export function parseCategory(value: unknown): RwaCategory | "all" {
  return RWA_CATEGORIES.some((category) => category.id === value) ? (value as RwaCategory) : "all";
}

export const RWA_SORTS = [
  {id: "popular", label: "Most popular"},
  {id: "change", label: "Today %"},
  {id: "price", label: "Price"},
  {id: "volume", label: "Volume"},
  {id: "mcap", label: "Market cap"},
  {id: "paired", label: "Most tokens paired"},
  {id: "az", label: "A–Z"},
] as const;
export type RwaSort = (typeof RWA_SORTS)[number]["id"];

export function parseRwaSort(value: unknown): RwaSort {
  return RWA_SORTS.some((sort) => sort.id === value) ? (value as RwaSort) : "popular";
}

/** "Today %" reads "Last session %" while the market is shut. */
export function sortLabel(sort: RwaSort, session: RwaSession): string {
  if (sort === "change") return session === "today" ? "Today %" : "Last session %";
  return RWA_SORTS.find((entry) => entry.id === sort)?.label ?? "Most popular";
}

export interface RwaBoardRow {
  ticker: string;
  /** Route id, as /rwa/[id] expects it. */
  id: string;
  name: string;
  logoUrl: string | null;
  categories: RwaCategory[];
  /** Last price of the stock — the same one the move is measured from. */
  priceUsd: number | null;
  /** Real market move, today or last session. The one figure the page shows. */
  changePct: number | null;
  /** Intraday closes, for the sparkline. */
  series: number[];
  /** The stock's dollar volume today: shares × price. */
  volumeUsd: number | null;
  /** The company's market cap. */
  marketCapUsd: number | null;
  /** Dollars of the stock token traded on Robinhood Chain today. */
  chainVolumeUsd: number | null;
  /** Tokens paired with it that traded in the last 24h. */
  pairedTokens: number;
  /** Their combined 24h volume — "Most popular"'s tie-breaker. */
  pairedVolumeUsd: number;
}

export interface RwaBoardPage {
  rows: RwaBoardRow[];
  next: number | null;
  total: number;
  session: RwaSession;
  /** First page only: how many stocks each category holds, before paging. */
  counts?: Record<RwaCategory | "all", number>;
}

/** The value a sort orders by; null goes last whichever way. */
function sortValue(row: RwaBoardRow, sort: RwaSort): number | string | null {
  switch (sort) {
    case "popular":
      return row.chainVolumeUsd;
    case "change":
      return row.changePct;
    case "price":
      return row.priceUsd;
    case "volume":
      return row.volumeUsd;
    case "mcap":
      return row.marketCapUsd;
    case "paired":
      return row.pairedTokens;
    case "az":
      return row.ticker;
  }
}

/**
 * The list in a sort's order: high to low (A–Z for names), rows without a
 * value last, then by ticker so the order is stable across pages.
 */
export function sortRwaRows(rows: readonly RwaBoardRow[], sort: RwaSort): RwaBoardRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    if (av != null && bv != null && av !== bv) {
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
      return (bv as number) - (av as number);
    }
    // Most popular: paired-token volume breaks a tie (and orders the stocks
    // with no chain volume at all), then paired count.
    if (sort === "popular") {
      const byPaired = b.pairedVolumeUsd - a.pairedVolumeUsd || b.pairedTokens - a.pairedTokens;
      if (byPaired !== 0) return byPaired;
    }
    return a.ticker.localeCompare(b.ticker);
  });
}

/** Top movers: the biggest real moves up (or down), stocks with a move only. */
export function topMovers(rows: readonly RwaBoardRow[], direction: "up" | "down", count = 4): RwaBoardRow[] {
  const moved = rows.filter((row) => row.changePct != null && (direction === "up" ? row.changePct > 0 : row.changePct < 0));
  return moved
    .sort((a, b) => (direction === "up" ? b.changePct! - a.changePct! : a.changePct! - b.changePct!))
    .slice(0, count);
}

/** A company name without its share-class boilerplate. */
export function shortCompanyName(name: string): string {
  return name
    .replace(/\s+(Class [A-Z]\s+)?(common stock|ordinary shares)$/i, "")
    .replace(/\s+American Depositary Shares$/i, "")
    .replace(/\s+Class [A-Z]$/i, "")
    .replace(/,?\s+(Inc|Corp)\.?$/i, "")
    .replace(/[\s,]+$/, "")
    .trim();
}

/**
 * Rows while someone is reading: fresh values for the rows on screen, in the
 * order they were, plus any rows a new page appended — never a reshuffle
 * under the pointer. Rows gone from the latest data keep their last values.
 */
export function keepOrder<T extends {ticker: string}>(shown: T[], latest: T[], frozen: boolean): T[] {
  if (!frozen || shown.length === 0) return latest;
  const byTicker = new Map(latest.map((row) => [row.ticker, row]));
  const onScreen = new Set(shown.map((row) => row.ticker));
  return [
    ...shown.map((row) => byTicker.get(row.ticker) ?? row),
    ...latest.filter((row) => !onScreen.has(row.ticker)),
  ];
}

/** "14 tokens" / "1 token". */
export function pairedLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "token" : "tokens"}`;
}

export interface RwaPost {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  text: string;
  url: string;
  publishedAt: string;
}

export interface RwaNewsItem {
  id: string;
  source: string;
  headline: string;
  publishedAt: string;
  imageUrl: string | null;
  ticker: string | null;
  /** The stock's logo, drawn when the story has no artwork of its own. */
  logoUrl: string | null;
  /** The same real move the list shows for that stock. */
  changePct: number | null;
}

export interface RwasOverview {
  session: RwaSession;
  /**
   * Every stock's price and move from one snapshot. The page draws every
   * price and % from this, so the list, the movers and the news always agree.
   */
  moves: Record<string, {priceUsd: number | null; changePct: number | null}>;
  movers: {up: RwaBoardRow[]; down: RwaBoardRow[]};
  posts: RwaPost[];
  news: RwaNewsItem[];
}
