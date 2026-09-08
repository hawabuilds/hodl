import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {flushQueuedForUser} from "@/lib/server/notifications/dispatch";
import {prefsFor, savePrefs, type NotificationPrefs} from "@/lib/server/notifications/prefs";
import {deleteSubscription, pushConfigured, saveSubscription, sendWebPush, vapidPublicKey} from "@/lib/server/notifications/push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  return json({
    vapidPublicKey: vapidPublicKey(),
    configured: pushConfigured(),
    prefs: await prefsFor(caller.userId),
  });
}

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    keys?: {p256dh?: string; auth?: string};
    prefs?: Partial<NotificationPrefs>;
    unsubscribe?: boolean;
    test?: boolean;
  };
  if (body.unsubscribe && body.endpoint) {
    await deleteSubscription(body.endpoint);
    return json({ok: true});
  }
  if (body.endpoint && body.keys?.p256dh && body.keys.auth) {
    await saveSubscription(
      caller.userId,
      {endpoint: body.endpoint, keys: {p256dh: body.keys.p256dh, auth: body.keys.auth}},
      request.headers.get("user-agent"),
    );
    await flushQueuedForUser(caller.userId);
  }
  if (body.test) {
    const pushed = await sendWebPush(caller.userId, {
      title: "Notifications are on",
      body: "This is a test from hodl.fan.",
      url: "/home",
    });
    return json({ok: true, prefs: await prefsFor(caller.userId), ...pushed});
  }
  if (body.prefs) {
    const prefs = await savePrefs(caller.userId, body.prefs);
    return json({ok: true, prefs});
  }
  if (!body.endpoint && !body.prefs) return badRequest("Nothing to save.");
  return json({ok: true, prefs: await prefsFor(caller.userId)});
}
