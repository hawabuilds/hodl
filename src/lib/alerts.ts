import {showsThreeState} from "./threeState";
import type {AssetKind} from "./types";

/**
 * In-app alerts on the desktop terminal: the Following feed and its count, the
 * bell, and the pop-ups. Kept pure so the rules can be tested apart from the
 * page. There is no push and no email behind any of this.
 */

export interface AlertPrefs {
  followBuys: boolean;
  followSells: boolean;
  followComments: boolean;
  replies: boolean;
  newFollowers: boolean;
  /** Off means no pop-ups; the bell and the Following count still update. */
  popups: boolean;
  /** Trades under this many dollars do not alert. 0 = every trade. */
  minTradeUsd: number;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  followBuys: true,
  followSells: true,
  followComments: true,
  replies: true,
  newFollowers: true,
  popups: true,
  minTradeUsd: 0,
};

export type AlertSwitch = Exclude<keyof AlertPrefs, "minTradeUsd">;

/**
 * A stored row as settings. The switches are three-state: a null column was
 * never touched, and reads as on.
 */
export function alertPrefsFromRow(row: Record<string, unknown> | null): AlertPrefs {
  if (!row) return {...DEFAULT_ALERT_PREFS};
  const flag = (value: unknown) => showsThreeState(value as boolean | null | undefined);
  const min = Number(row.min_trade_usd);
  return {
    followBuys: flag(row.follow_buys),
    followSells: flag(row.follow_sells),
    followComments: flag(row.follow_comments),
    replies: flag(row.replies),
    newFollowers: flag(row.new_followers),
    popups: flag(row.popups),
    minTradeUsd: Number.isFinite(min) && min > 0 ? min : 0,
  };
}

export function alertPrefsToRow(prefs: AlertPrefs): Record<string, unknown> {
  return {
    follow_buys: prefs.followBuys,
    follow_sells: prefs.followSells,
    follow_comments: prefs.followComments,
    replies: prefs.replies,
    new_followers: prefs.newFollowers,
    popups: prefs.popups,
    min_trade_usd: prefs.minTradeUsd,
  };
}

/** Keeps only fields a client may set, each of the right type. */
export function cleanAlertPatch(input: unknown): Partial<AlertPrefs> {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const patch: Partial<AlertPrefs> = {};
  const switches: AlertSwitch[] = [
    "followBuys",
    "followSells",
    "followComments",
    "replies",
    "newFollowers",
    "popups",
  ];
  for (const key of switches) {
    if (typeof raw[key] === "boolean") patch[key] = raw[key] as boolean;
  }
  if (raw.minTradeUsd !== undefined) {
    const min = Number(raw.minTradeUsd);
    if (Number.isFinite(min) && min >= 0) patch.minTradeUsd = Math.min(Math.round(min * 100) / 100, 1e12);
  }
  return patch;
}

export interface ActivityPerson {
  id: string;
  handle: string;
  displayName: string;
  pfpUrl: string | null;
}

export interface ActivityAsset {
  kind: AssetKind;
  id: string;
  symbol: string;
  /** The RWA a token is paired against, for the "AI · NVDA" chip. */
  pairedTicker: string | null;
  imageUrl: string | null;
}

export type FollowingItem =
  | {
      type: "trade";
      id: string;
      at: string;
      person: ActivityPerson;
      side: "buy" | "sell";
      /** Null when the dollar leg could not be read; the row says so. */
      usd: number | null;
      asset: ActivityAsset;
    }
  | {
      type: "comment";
      id: string;
      at: string;
      person: ActivityPerson;
      body: string;
      asset: ActivityAsset;
    };

export type BellItem =
  | {
      type: "reply";
      /** The reply's comment id. */
      id: string;
      at: string;
      person: ActivityPerson;
      body: string;
      asset: ActivityAsset;
    }
  | {
      type: "follow";
      id: string;
      at: string;
      person: ActivityPerson;
    };

export interface Activity {
  following: FollowingItem[];
  bell: BellItem[];
  followingSeenAt: string | null;
  bellSeenAt: string | null;
  /** How many people you follow, for the empty state. */
  followingCount: number;
}

/** Whether an item from someone you follow should count and alert. */
export function followingAlerts(item: FollowingItem, prefs: AlertPrefs): boolean {
  if (item.type === "comment") return prefs.followComments;
  if (item.side === "buy" ? !prefs.followBuys : !prefs.followSells) return false;
  if (prefs.minTradeUsd <= 0) return true;
  // A trade whose size is unknown cannot be shown to clear a threshold.
  return item.usd != null && item.usd >= prefs.minTradeUsd;
}

export function bellAlerts(item: BellItem, prefs: AlertPrefs): boolean {
  return item.type === "reply" ? prefs.replies : prefs.newFollowers;
}

function newerThan(at: string, seenAt: string | null): boolean {
  if (!seenAt) return true;
  return Date.parse(at) > Date.parse(seenAt);
}

export function unreadFollowing(activity: Activity, prefs: AlertPrefs): number {
  return activity.following.filter(
    (item) => newerThan(item.at, activity.followingSeenAt) && followingAlerts(item, prefs),
  ).length;
}

export function visibleBell(activity: Activity, prefs: AlertPrefs): BellItem[] {
  return activity.bell.filter((item) => bellAlerts(item, prefs));
}

export function unreadBell(activity: Activity, prefs: AlertPrefs): number {
  return visibleBell(activity, prefs).filter((item) => newerThan(item.at, activity.bellSeenAt))
    .length;
}

/** Newest first, ties broken by id so the order never flickers between polls. */
export function mergeActivity<T extends {at: string; id: string}>(lists: T[][], limit: number): T[] {
  return lists
    .flat()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1))
    .slice(0, limit);
}

// ── Pop-ups ────────────────────────────────────────────────────────────

export const TOAST_MS = 5_000;
export const TOAST_MAX = 3;
export const TOAST_GROUP_WINDOW_MS = 10_000;

export type ToastKind = "trade" | "reply";

export type Toast =
  | {id: string; kind: ToastKind; group: false; item: FollowingItem | BellItem; shownAt: number}
  | {
      id: string;
      kind: ToastKind;
      group: true;
      count: number;
      /** The newest of the group, which is where clicking it goes. */
      latest: FollowingItem | BellItem;
      shownAt: number;
    };

export interface ToastState {
  toasts: Toast[];
  /** When each recent pop-up of each kind arrived, for grouping. */
  arrivals: {kind: ToastKind; at: number}[];
}

export const EMPTY_TOASTS: ToastState = {toasts: [], arrivals: []};

export function groupToastId(kind: ToastKind): string {
  return `group:${kind}`;
}

/**
 * Adds new pop-ups, keeping at most three on screen.
 *
 * More than three of a kind inside ten seconds become one pop-up that counts
 * them ("5 new trades from people you follow"), and later ones inside the
 * same burst add to its count rather than starting new pop-ups.
 */
export function pushToasts(
  state: ToastState,
  incoming: {kind: ToastKind; item: FollowingItem | BellItem}[],
  now: number,
): ToastState {
  if (incoming.length === 0) return state;
  const arrivals = [
    ...state.arrivals.filter((entry) => now - entry.at < TOAST_GROUP_WINDOW_MS),
    ...incoming.map(({kind}) => ({kind, at: now})),
  ];
  let toasts = [...state.toasts];

  for (const kind of ["trade", "reply"] as const) {
    const fresh = incoming.filter((entry) => entry.kind === kind);
    if (fresh.length === 0) continue;
    const groupId = groupToastId(kind);
    const existingGroup = toasts.find((toast) => toast.id === groupId);
    const burst = arrivals.filter((entry) => entry.kind === kind).length;

    if (existingGroup?.group) {
      toasts = toasts.map((toast) =>
        toast.id === groupId && toast.group
          ? {...toast, count: toast.count + fresh.length, latest: fresh[fresh.length - 1]!.item, shownAt: now}
          : toast,
      );
    } else if (burst > TOAST_MAX) {
      // The individual pop-ups of this kind fold into the group.
      const folded = toasts.filter((toast) => toast.kind === kind && !toast.group).length;
      toasts = toasts.filter((toast) => toast.kind !== kind);
      toasts.push({
        id: groupId,
        kind,
        group: true,
        count: Math.max(burst, folded + fresh.length),
        latest: fresh[fresh.length - 1]!.item,
        shownAt: now,
      });
    } else {
      for (const {item} of fresh) {
        if (toasts.some((toast) => toast.id === `${kind}:${item.id}`)) continue;
        toasts.push({id: `${kind}:${item.id}`, kind, group: false, item, shownAt: now});
      }
    }
  }

  // Oldest leave first when there are more than fit.
  if (toasts.length > TOAST_MAX) toasts = toasts.slice(toasts.length - TOAST_MAX);
  return {toasts, arrivals};
}

export function dismissToast(state: ToastState, id: string): ToastState {
  return {...state, toasts: state.toasts.filter((toast) => toast.id !== id)};
}

/** "$500", "$1.2K", "$12K" — a pop-up has room for a rough size only. */
export function tradeUsdLabel(usd: number | null): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 1) return "<$1";
  if (usd < 1_000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd < 1_000_000) return `$${(usd / 1_000).toFixed(usd < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `$${(usd / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function groupToastText(kind: ToastKind, count: number): string {
  return kind === "trade"
    ? `${count} new trades from people you follow`
    : `${count} new replies to your comments`;
}
