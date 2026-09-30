import type {AssetComment, AssetKind, ChartStyle, SocialLinks} from "./types";

/**
 * Everything the signed-in person changes, kept in their browser.
 *
 * There is no database yet and no real order routing, so the watchlist, the
 * simulated book, posted comments, follows and profile edits all live here.
 * Each store is namespaced and defensive: a corrupt or absent value reads as
 * empty rather than throwing, because private browsing can block storage
 * entirely and none of this is worth taking the app down over.
 */

const NS = "rwa";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`${NS}.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${NS}.${key}`, JSON.stringify(value));
  } catch {
    // Storage may be blocked; the in-memory state stays correct for this session.
  }
}

/** Fires after any local write so open views re-read without a reload. */
export const LOCAL_STORE_EVENT = "rwa:localstore";

function announce(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_STORE_EVENT));
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

/** Entries are `kind:id`, so one list holds both sides of the universe. */
export type WatchKey = string;

export function watchKey(kind: AssetKind, id: string): WatchKey {
  return `${kind}:${id.toLowerCase()}`;
}

export function readWatchlist(): WatchKey[] {
  return read<WatchKey[]>("watchlist", []);
}

export function isWatched(kind: AssetKind, id: string): boolean {
  return readWatchlist().includes(watchKey(kind, id));
}

export function writeWatchlist(keys: WatchKey[]): void {
  write("watchlist", keys);
  announce();
}

export function toggleWatch(kind: AssetKind, id: string): boolean {
  const key = watchKey(kind, id);
  const current = readWatchlist();
  const next = current.includes(key)
    ? current.filter((entry) => entry !== key)
    : [...current, key];
  write("watchlist", next);
  announce();
  return next.includes(key);
}

// ---------------------------------------------------------------------------
// The simulated book
// ---------------------------------------------------------------------------

export interface Position {
  kind: AssetKind;
  assetId: string;
  symbol: string;
  name: string;
  amount: number;
  /** Total dollars put in, used for the average cost line. */
  costUsd: number;
}

export interface SimOrder {
  id: string;
  kind: AssetKind;
  assetId: string;
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  amountUsd: number;
  priceUsd: number;
  feeUsd: number;
  at: string;
}

export interface Book {
  cashUsd: number;
  positions: Position[];
  orders: SimOrder[];
}

/** Simulated starting balance, so the buy sheet has something to spend. */
export const STARTING_CASH_USD = 10_000;

const EMPTY_BOOK: Book = {cashUsd: STARTING_CASH_USD, positions: [], orders: []};

/** True once a book has been written, seeded or otherwise. */
export function hasBook(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${NS}.book`) !== null;
  } catch {
    return false;
  }
}

/**
 * Writes the opening book.
 *
 * Called once, on the first run, with positions priced from the live feed so
 * the sample holdings are consistent with the market the rest of the app is
 * showing. Never overwrites an existing book — someone who has sold everything
 * down to cash has an empty book on purpose.
 */
export function seedBook(positions: Position[], cashUsd: number): void {
  if (hasBook()) return;
  write("book", {cashUsd, positions, orders: []} satisfies Book);
  announce();
}

export function readBook(): Book {
  const book = read<Book>("book", EMPTY_BOOK);
  return {
    cashUsd: Number.isFinite(book.cashUsd) ? book.cashUsd : STARTING_CASH_USD,
    positions: Array.isArray(book.positions) ? book.positions : [],
    orders: Array.isArray(book.orders) ? book.orders : [],
  };
}

/** Paper fills are gone. A real trade or an error — nothing in between. */

export function resetBook(): void {
  write("book", EMPTY_BOOK);
  announce();
}

// ---------------------------------------------------------------------------
// Trade settings
// ---------------------------------------------------------------------------

export interface TradeSettings {
  /** Maximum price move tolerated between quote and fill, in percent. */
  slippagePct: number;
  /** Which currency the amount field is denominated in. */
  currency: "USD" | "ETH";
}

export const SLIPPAGE_PRESETS = [0.5, 1, 3] as const;
export const MAX_SLIPPAGE_PCT = 15;
export const SLIPPAGE_WARN_PCT = 5;

const DEFAULT_TRADE_SETTINGS: TradeSettings = {slippagePct: 1, currency: "USD"};

export function readTradeSettings(): TradeSettings {
  const stored = read<Partial<TradeSettings>>("trade", {});
  const slippage = Number(stored.slippagePct);
  return {
    slippagePct:
      Number.isFinite(slippage) && slippage > 0 && slippage <= MAX_SLIPPAGE_PCT
        ? slippage
        : DEFAULT_TRADE_SETTINGS.slippagePct,
    currency: stored.currency === "ETH" ? "ETH" : "USD",
  };
}

export function writeTradeSettings(settings: TradeSettings): void {
  write("trade", settings);
  announce();
}

// ---------------------------------------------------------------------------
// Quick buy (desktop Tokens table)
// ---------------------------------------------------------------------------

export const DEFAULT_QUICK_BUY_USD = 25;

/** Dollars per quick buy, kept in the browser when nobody is signed in. */
export function readQuickBuyUsd(): number {
  const stored = Number(read<number>("quick-buy-usd", DEFAULT_QUICK_BUY_USD));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_QUICK_BUY_USD;
}

export function writeQuickBuyUsd(amount: number): void {
  write("quick-buy-usd", amount);
  announce();
}

/** Allocation targets without a signed-in account (demo mode). Signed in, they live on the profile. */
export function readAllocationTargets(): Record<string, number> {
  const stored = read<Record<string, number>>("allocation-targets", {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

export function writeAllocationTargets(targets: Record<string, number>): void {
  write("allocation-targets", targets);
  announce();
}

// ---------------------------------------------------------------------------
// Comments posted in this browser
// ---------------------------------------------------------------------------

export function readLocalComments(assetId: string): AssetComment[] {
  const all = read<Record<string, AssetComment[]>>("comments", {});
  return all[assetId] ?? [];
}

export function writeLocalComment(comment: AssetComment): void {
  const all = read<Record<string, AssetComment[]>>("comments", {});
  const existing = all[comment.assetId] ?? [];
  write("comments", {...all, [comment.assetId]: [...existing, comment]});
  announce();
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

export function readFollowing(): string[] {
  return read<string[]>("following", []);
}

export function isFollowing(handle: string): boolean {
  return readFollowing().includes(handle.toLowerCase());
}

export function writeFollowing(handles: string[]): void {
  write(
    "following",
    handles.map((handle) => handle.replace(/^@/, "").toLowerCase()),
  );
  announce();
}

export function toggleFollow(handle: string): boolean {
  const key = handle.toLowerCase();
  const current = readFollowing();
  const next = current.includes(key)
    ? current.filter((entry) => entry !== key)
    : [...current, key];
  write("following", next);
  announce();
  return next.includes(key);
}

// ---------------------------------------------------------------------------
// Profile edits
// ---------------------------------------------------------------------------

export interface ProfileEdits {
  displayName: string | null;
  bio: string | null;
  socials: Partial<SocialLinks>;
}

const EMPTY_EDITS: ProfileEdits = {displayName: null, bio: null, socials: {}};

export function readProfileEdits(): ProfileEdits {
  const stored = read<ProfileEdits>("profile", EMPTY_EDITS);
  return {
    displayName: stored.displayName ?? null,
    bio: stored.bio ?? null,
    socials: stored.socials ?? {},
  };
}

export function writeProfileEdits(edits: ProfileEdits): void {
  write("profile", edits);
  announce();
}

/** Last-seen identity row. Lets the profile header paint before Privy/network. */
export interface CachedMe {
  displayName: string;
  handle: string | null;
  pfpUrl: string | null;
  wallet: string | null;
  bio: string;
}

export function readCachedMe(): CachedMe | null {
  const stored = read<CachedMe | null>("me-row", null);
  return stored?.displayName ? stored : null;
}

export function writeCachedMe(row: CachedMe): void {
  write("me-row", row);
}

export function hasCachedMe(): boolean {
  return readCachedMe() != null;
}

/** Token addresses this wallet last held — used to skip a universe scan. */
export function readKnownHoldings(wallet: string): string[] {
  const all = read<Record<string, string[]>>("held-tokens", {});
  return all[wallet.toLowerCase()] ?? [];
}

export function writeKnownHoldings(wallet: string, addresses: string[]): void {
  const all = read<Record<string, string[]>>("held-tokens", {});
  all[wallet.toLowerCase()] = addresses;
  write("held-tokens", all);
}

// ---------------------------------------------------------------------------
// Chart style (line vs candles)
// ---------------------------------------------------------------------------

export function readChartStyle(): ChartStyle {
  const stored = read<ChartStyle | null>("chart-style", null);
  return stored === "candles" ? "candles" : "line";
}

export function writeChartStyle(style: ChartStyle): void {
  write("chart-style", style === "candles" ? "candles" : "line");
  announce();
}
