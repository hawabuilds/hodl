export const PUSH_DECLINED_KEY = "rwa.push.declinedAt";
export const PUSH_INTENT_KEY = "rwa.push.intent";
export const DECLINE_DAYS = 30;

export type PushIntent = "watchlist" | "comment" | "follow";

export function isIosSafari(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return ios && webkit;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const ios = "standalone" in navigator && Boolean((navigator as Navigator & {standalone?: boolean}).standalone);
  return Boolean(media || ios);
}

export function safariNeedsHomeScreen(ua?: string): boolean {
  return isIosSafari(ua) && !isStandaloneDisplay();
}

export function pushApiAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function declinedRecently(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(PUSH_DECLINED_KEY);
    if (!raw) return false;
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < DECLINE_DAYS * 24 * 60 * 60_000;
  } catch {
    return false;
  }
}

export function markPushDeclined(now = new Date()): void {
  try {
    window.localStorage.setItem(PUSH_DECLINED_KEY, now.toISOString());
  } catch {
    // private mode
  }
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
