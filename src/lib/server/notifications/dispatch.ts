import {db, hasDatabase} from "@/lib/server/db";
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
  if (channel === "social") {
    if (kind === "follow") return prefs.socialFollow;
    if (kind === "reply") return prefs.socialReply;
    return prefs.socialFollow || prefs.socialReply;
  }
  if (channel === "holdings") return prefs.holdingsOn;
  return prefs.watchlistOn;
}

export async function enqueueNotification(req: NotifyRequest): Promise<"sent" | "queued" | "skipped"> {
  if (!hasDatabase) return "skipped";
  const now = req.now ?? new Date();
  const prefs = await prefsFor(req.userId);
  if (!allowed(prefs, req.channel, req.kind)) return "skipped";

  if (req.dedupeKey) {
    const {data: dup} = await db()
      .from("notification_log")
      .select("id")
      .eq("user_id", req.userId)
      .eq("dedupe_key", req.dedupeKey)
      .maybeSingle();
    if (dup) return "skipped";
  }

  const quiet = inQuietHours(now, {
    timezone: prefs.timezone,
    quietStart: prefs.quietStart,
    quietEnd: prefs.quietEnd,
  });
  const day = dayStamp(now, prefs.timezone);
  const used = await deliveredToday(req.userId, req.channel, day);
  const overCap = used >= DAILY_CAPS[req.channel];

  const payload: PushPayload = {title: req.title, body: req.body, url: req.url};
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
  const pushed = await sendWebPush(req.userId, payload);
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
    .select("id, user_id, channel, title, body, url, payload, created_at")
    .eq("user_id", userId)
    .is("delivered_at", null)
    .order("created_at", {ascending: true})
    .limit(20);
  if (!data?.length) return 0;
  const ids = data.map((row) => row.id);
  const pushed = await sendWebPush(userId, {
    title: data.length === 1 ? data[0]!.title : `${data.length} updates`,
    body:
      data.length === 1
        ? data[0]!.body
        : data
            .slice(0, 3)
            .map((row) => row.body)
            .join(" · "),
    url: data[0]?.url || "/home",
  });
  if (pushed.sent === 0) return 0;
  await db()
    .from("notification_log")
    .update({delivered_at: now.toISOString()})
    .in("id", ids);
  return data.length;
}

/** Flush quiet-hours / cap overflow as one digest per channel. */
export async function flushQueuedNotifications(now = new Date()): Promise<number> {
  if (!hasDatabase) return 0;
  const {data} = await db()
    .from("notification_log")
    .select("id, user_id, channel, title, body, url, payload, created_at")
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
    const channels = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = channels.get(row.channel) ?? [];
      list.push(row);
      channels.set(row.channel, list);
    }
    for (const [channel, items] of channels) {
      const ids = items.map((row) => row.id);
      if (items.length === 1) {
        const item = items[0]!;
        const pushed = await sendWebPush(userId, {
          title: item.title,
          body: item.body,
          url: item.url || "/home",
        });
        if (pushed.sent === 0) continue;
      } else {
        const pushed = await sendWebPush(userId, {
          title: `${items.length} ${channel} updates`,
          body: items
            .slice(0, 3)
            .map((row) => row.body)
            .join(" · "),
          url: items[0]?.url || "/home",
        });
        if (pushed.sent === 0) continue;
      }
      await db()
        .from("notification_log")
        .update({delivered_at: now.toISOString()})
        .in("id", ids);
      flushed += items.length;
    }
  }
  return flushed;
}
