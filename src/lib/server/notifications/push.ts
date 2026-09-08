import {db, hasDatabase} from "@/lib/server/db";
import {appOrigin} from "@/config/appUrl";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

type SubRow = {endpoint: string; p256dh: string; auth: string};

export function vapidPublicKey(): string {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "").trim();
}

function vapidPrivateKey(): string {
  return (process.env.VAPID_PRIVATE_KEY ?? "").trim();
}

export function pushConfigured(): boolean {
  return Boolean(vapidPublicKey() && vapidPrivateKey());
}

export async function saveSubscription(
  userId: string,
  sub: {endpoint: string; keys: {p256dh: string; auth: string}},
  userAgent: string | null,
): Promise<void> {
  if (!hasDatabase) return;
  await db().from("push_subscriptions").upsert({
    endpoint: sub.endpoint,
    user_id: userId,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: userAgent,
  });
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  if (!hasDatabase) return;
  await db().from("push_subscriptions").delete().eq("endpoint", endpoint);
}

async function subscriptionsFor(userId: string): Promise<SubRow[]> {
  if (!hasDatabase) return [];
  const {data} = await db()
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  return (data ?? []) as SubRow[];
}

export async function sendWebPush(userId: string, payload: PushPayload): Promise<{sent: number; gone: number}> {
  if (!pushConfigured()) {
    console.info("web-push not configured");
    return {sent: 0, gone: 0};
  }
  const subs = await subscriptionsFor(userId);
  if (!subs.length) {
    console.info("web-push no subscriptions");
    return {sent: 0, gone: 0};
  }
  const webpush = await import("web-push");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || `mailto:ops@${new URL(appOrigin()).hostname}`,
    vapidPublicKey(),
    vapidPrivateKey(),
  );
  let sent = 0;
  let gone = 0;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {p256dh: sub.p256dh, auth: sub.auth},
          },
          body,
          {TTL: 86_400, urgency: "high"},
        );
        sent += 1;
      } catch (error) {
        const status = (error as {statusCode?: number}).statusCode;
        if (status === 404 || status === 410) {
          gone += 1;
          await deleteSubscription(sub.endpoint);
        } else {
          const apple = sub.endpoint.includes("web.push.apple.com");
          const raw = (error as {body?: unknown}).body;
          const body = typeof raw === "string" ? raw.slice(0, 200) : "";
          console.error("web-push send failed", {status: status ?? null, apple, body});
        }
      }
    }),
  );
  return {sent, gone};
}
