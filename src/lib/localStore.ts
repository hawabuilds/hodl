import type {AssetComment, AssetKind, SocialLinks} from "./types";

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

export function readBook(): Book {
  const book = read<Book>("book", EMPTY_BOOK);
  return {
    cashUsd: Number.isFinite(book.cashUsd) ? book.cashUsd : STARTING_CASH_USD,
    positions: Array.isArray(book.positions) ? book.positions : [],
    orders: Array.isArray(book.orders) ? book.orders : [],
  };
}

export interface FillInput {
  kind: AssetKind;
  assetId: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  amountUsd: number;
  priceUsd: number;
}

export interface FillResult {
  ok: boolean;
  error?: string;
  order?: SimOrder;
}

/**
 * Records a simulated fill against the local book.
 *
 * Nothing here touches a wallet or a router — the trade is bookkeeping only,
 * and every surface that shows a position says so. Validation is still real,
 * because getting the failure modes right now is what makes the switch to a
 * live router a small change later.
 */
export function applyFill(input: FillInput): FillResult {
  const {kind, assetId, symbol, name, side, amountUsd, priceUsd} = input;

  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return {ok: false, error: "Enter an amount."};
  }
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return {ok: false, error: "No price for this asset right now."};
  }

  const book = readBook();
  const positions = [...book.positions];
  const index = positions.findIndex(
    (p) => p.assetId === assetId && p.kind === kind,
  );
  const units = amountUsd / priceUsd;

  if (side === "buy") {
    if (amountUsd > book.cashUsd + 1e-9) {
      return {ok: false, error: "Not enough simulated cash."};
    }
    if (index === -1) {
      positions.push({kind, assetId, symbol, name, amount: units, costUsd: amountUsd});
    } else {
      positions[index] = {
        ...positions[index],
        amount: positions[index].amount + units,
        costUsd: positions[index].costUsd + amountUsd,
      };
    }
  } else {
    if (index === -1) return {ok: false, error: `You do not hold any ${symbol}.`};
    const held = positions[index];
    if (units > held.amount + 1e-9) {
      return {ok: false, error: `You only hold ${held.amount.toPrecision(6)} ${symbol}.`};
    }
    const remaining = held.amount - units;
    // Cost basis is reduced proportionally, so a partial sell leaves the average
    // entry price unchanged rather than flattering it.
    const costLeft = held.amount === 0 ? 0 : held.costUsd * (remaining / held.amount);
    if (remaining <= 1e-12) positions.splice(index, 1);
    else positions[index] = {...held, amount: remaining, costUsd: costLeft};
  }

  const order: SimOrder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    assetId,
    symbol,
    side,
    amount: units,
    amountUsd,
    priceUsd,
    at: new Date().toISOString(),
  };

  write("book", {
    cashUsd: side === "buy" ? book.cashUsd - amountUsd : book.cashUsd + amountUsd,
    positions,
    orders: [order, ...book.orders].slice(0, 200),
  } satisfies Book);
  announce();

  return {ok: true, order};
}

export function resetBook(): void {
  write("book", EMPTY_BOOK);
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
