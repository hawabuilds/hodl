import {db, hasDatabase} from "@/lib/server/db";
import {DEFAULT_PREFS, type NotificationPrefs} from "@/lib/notifications/prefs";
import {DEFAULT_HOLDINGS_MULTIPLES, DEFAULT_WATCHLIST_MULTIPLES, type Milestone} from "@/lib/notifications/milestones";

export type {NotificationPrefs};
export {DEFAULT_PREFS};

function asMilestones(value: unknown, fallback: Milestone[]): Milestone[] {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set([2, 3, 5, 10, 25, 50, 100]);
  const out = value.map(Number).filter((n) => allowed.has(n)) as Milestone[];
  return out.length ? (out as Milestone[]) : fallback;
}

function fromRow(row: Record<string, unknown> | null): NotificationPrefs {
  if (!row) return {...DEFAULT_PREFS};
  return {
    muted: row.muted === true,
    socialFollow: row.social_follow !== false,
    socialReply: row.social_reply !== false,
    holdingsOn: row.holdings_on !== false,
    holdingsMultiples: asMilestones(row.holdings_multiples, DEFAULT_HOLDINGS_MULTIPLES),
    watchlistOn: row.watchlist_on === true,
    watchlistMultiples: asMilestones(row.watchlist_multiples, DEFAULT_WATCHLIST_MULTIPLES),
    minPositionUsd: Number(row.min_position_usd) > 0 ? Number(row.min_position_usd) : 10,
    quietStart: typeof row.quiet_start === "string" ? row.quiet_start : null,
    quietEnd: typeof row.quiet_end === "string" ? row.quiet_end : null,
    timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : "UTC",
  };
}

export async function prefsFor(userId: string): Promise<NotificationPrefs> {
  if (!hasDatabase) return {...DEFAULT_PREFS};
  const {data} = await db()
    .from("notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return fromRow(data as Record<string, unknown> | null);
}

export async function savePrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const current = await prefsFor(userId);
  const next: NotificationPrefs = {...current, ...patch};
  if (!hasDatabase) return next;
  await db().from("notification_prefs").upsert({
    user_id: userId,
    muted: next.muted,
    social_follow: next.socialFollow,
    social_reply: next.socialReply,
    holdings_on: next.holdingsOn,
    holdings_multiples: next.holdingsMultiples,
    watchlist_on: next.watchlistOn,
    watchlist_multiples: next.watchlistMultiples,
    min_position_usd: next.minPositionUsd,
    quiet_start: next.quietStart,
    quiet_end: next.quietEnd,
    timezone: next.timezone,
    updated_at: new Date().toISOString(),
  });
  return next;
}
