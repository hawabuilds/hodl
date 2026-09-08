import {db, hasDatabase} from "@/lib/server/db";
import {digestFromItems, type DigestMeta} from "@/lib/notifications/copy";
import {isFreshDedupe} from "@/lib/notifications/dedupe";
import {inQuietHours} from "@/lib/notifications/quietHours";
import {prefsFor, type NotificationPrefs} from "./prefs";
import {sendWebPush, type PushPayload} from "./push";

export const DAILY_CAPS = {
  social: 20,
  holdings: 12,
  watchlist: 8,
} as const;

export type NotifyChannel = keyof typeof DAILY_CAPS;

export type NotifyRequest = {
  userId: string;
  channel: NotifyChannel;
  kind: string;
  title: string;
  body: string;
  url: string;
  dedupeKey?: string;
  now?: Date;
  digest?: DigestMeta;
  handles?: string[];
};

function dayStamp(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

async function deliveredToday(userId: string, channel: NotifyChannel, day: string): Promise<number> {
  if (!hasDatabase) return 0;
  const start = `${day}T00:00:00.000Z`;
  const {count} = await db()
    .from("notification_log")
    .select("*", {count: "exact", head: true})
    .eq("user_id", userId)
    .eq("channel", channel)
    .not("delivered_at", "is", null)
    .gte("created_at", start);
  return count ?? 0;
}

function allowed(prefs: NotificationPrefs, channel: NotifyChannel, kind: string): boolean {
  if (prefs.muted) return false;
  if (kind === "trade" || kind === "trade_failed") return true;
  if (channel === "social") {
    if (kind === "follow") return prefs.socialFollow;
    if (kind === "reply") return prefs.socialReply;
    return prefs.socialFollow || prefs.socialReply;
  }
  if (channel === "holdings") return prefs.holdingsOn;
  return prefs.watchlistOn;
}

function storedPayload(req: NotifyRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: req.title,
    body: req.body,
    url: req.url,
  };
  if (req.digest) payload.d = req.digest;
  if (req.handles?.length) payload.handles = req.handles;
  return payload;
}

function wirePayload(title: string, body: string, url: string): PushPayload {
  return {title, body, url};
}

export async function enqueueNotification(req: NotifyRequest): Promise<"sent" | "queued" | "skipped"> {
  if (!hasDatabase) return "skipped";
  const now = req.now ?? new Date();
  const prefs = await prefsFor(req.userId);
  if (!allowed(prefs, req.channel, req.kind)) return "skipped";

  if (req.dedupeKey) {
    const {data: dup} = await db()
      .from("notification_log")
      .select("id, created_at")
      .eq("user_id", req.userId)
      .eq("dedupe_key", req.dedupeKey)
      .maybeSingle();
    if (dup) {
      if (isFreshDedupe(String(dup.created_at), now)) {
        console.info("push", req.kind, "skipped dedupe");
        return "skipped";
      }
      await db().from("notification_log").delete().eq("id", dup.id);
    }
  }

  const quiet = inQuietHours(now, {
    timezone: prefs.timezone,
    quietStart: prefs.quietStart,
    quietEnd: prefs.quietEnd,
  });
  const day = dayStamp(now, prefs.timezone);
  const used = await deliveredToday(req.userId, req.channel, day);
  const overCap = used >= DAILY_CAPS[req.channel];

  const payload = storedPayload(req);
  const {data, error} = await db()
    .from("notification_log")
    .insert({
      user_id: req.userId,
      channel: req.channel,
      kind: req.kind,
      dedupe_key: req.dedupeKey ?? null,
      title: req.title,
      body: overCap ? `${req.body} (in today's digest)` : req.body,
      url: req.url,
      payload,
      delivered_at: null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return "skipped";

  if (quiet || overCap) return "queued";
  const pushed = await sendWebPush(req.userId, wirePayload(req.title, req.body, req.url));
  console.info("push", req.kind, "sent", pushed.sent, "gone", pushed.gone);
  if (pushed.sent === 0) return "queued";
  await db()
    .from("notification_log")
    .update({delivered_at: now.toISOString()})
    .eq("id", data.id);
  return "sent";
}

export async function flushQueuedForUser(userId: string, now = new Date()): Promise<number> {
  if (!hasDatabase) return 0;
  const {data} = await db()
    .from("notification_log")
    .select("id, user_id, channel, kind, title, body, url, payload, created_at")
    .eq("user_id", userId)
    .is("delivered_at", null)
    .order("created_at", {ascending: true})
    .limit(20);
  if (!data?.length) return 0;
  const ids = data.map((row) => row.id);
  const digest =
    data.length === 1
      ? {title: data[0]!.title, body: data[0]!.body, url: data[0]!.url || "/home"}
      : {...digestFromItems(data), url: "/home"};
  const pushed = await sendWebPush(userId, wirePayload(digest.title, digest.body, digest.url));
  if (pushed.sent === 0) return 0;
  await db()
    .from("notification_log")
    .update({delivered_at: now.toISOString()})
    .in("id", ids);
  return data.length;
}

/** Flush quiet-hours / cap overflow as one digest per user. */
export async function flushQueuedNotifications(now = new Date()): Promise<number> {
  if (!hasDatabase) return 0;
  const {data} = await db()
    .from("notification_log")
    .select("id, user_id, channel, kind, title, body, url, payload, created_at")
    .is("delivered_at", null)
    .order("created_at", {ascending: true})
    .limit(200);
  if (!data?.length) return 0;

  const byUser = new Map<string, typeof data>();
  for (const row of data) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  let flushed = 0;
  for (const [userId, rows] of byUser) {
    const prefs = await prefsFor(userId);
    if (prefs.muted) continue;
    if (
      inQuietHours(now, {
        timezone: prefs.timezone,
        quietStart: prefs.quietStart,
        quietEnd: prefs.quietEnd,
      })
    ) {
      continue;
    }
    const digest =
      rows.length === 1
        ? {title: rows[0]!.title, body: rows[0]!.body, url: rows[0]!.url || "/home"}
        : {...digestFromItems(rows), url: "/home"};
    const pushed = await sendWebPush(userId, wirePayload(digest.title, digest.body, digest.url));
    if (pushed.sent === 0) continue;
    await db()
      .from("notification_log")
      .update({delivered_at: now.toISOString()})
      .in(
        "id",
        rows.map((row) => row.id),
      );
    flushed += rows.length;
  }
  return flushed;
}
