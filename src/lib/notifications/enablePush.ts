"use client";

import {urlBase64ToUint8Array} from "./pushClient";

/**
 * iOS Web Push only shows the system prompt when this is the first await
 * in a tap handler. Do not fetch or getAccessToken before calling this.
 */
export async function requestPermissionFromGesture(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") {
    console.warn("Notification API missing");
    return "denied";
  }
  try {
    const permission = await Notification.requestPermission();
    console.info("Notification.requestPermission", permission);
    return permission;
  } catch (error) {
    console.error("Notification.requestPermission failed", error);
    return "denied";
  }
}

export async function savePushSubscription(
  getToken: () => Promise<string | null>,
  opts?: {test?: boolean},
): Promise<{ok: boolean; reason?: string; sent?: number}> {
  const token = await getToken();
  if (!token) return {ok: false, reason: "no-token"};
  const configRes = await fetch("/api/me/push", {headers: {authorization: `Bearer ${token}`}});
  if (!configRes.ok) return {ok: false, reason: "config"};
  const {vapidPublicKey, configured} = (await configRes.json()) as {
    vapidPublicKey?: string;
    configured?: boolean;
  };
  if (!configured || !vapidPublicKey) {
    console.error("push not configured on server");
    return {ok: false, reason: "no-vapid"};
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return {ok: false, reason: "no-push-api"};
  }
  await navigator.serviceWorker.register("/sw.js", {scope: "/"});
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return {ok: false, reason: "no-sub"};
  }
  const saveRes = await fetch("/api/me/push", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      test: opts?.test ?? true,
    }),
  });
  if (!saveRes.ok) return {ok: false, reason: "save"};
  const data = (await saveRes.json()) as {sent?: number};
  return {ok: true, sent: data.sent};
}
