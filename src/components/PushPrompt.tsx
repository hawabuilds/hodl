"use client";

import {useCallback, useEffect, useState} from "react";
import {Button} from "@/components/ui/Button";
import {Sheet} from "@/components/ui/Sheet";
import {useSession} from "@/lib/session";
import {useUser} from "@/hooks/useUser";
import {requestPermissionFromGesture, savePushSubscription} from "@/lib/notifications/enablePush";
import {
  declinedRecently,
  isStandaloneDisplay,
  markPushDeclined,
  pushApiAvailable,
  safariNeedsHomeScreen,
  type PushIntent,
} from "@/lib/notifications/pushClient";

export function requestPushIntent(intent: PushIntent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("rwa:push-intent", {detail: intent}));
}

const COPY: Record<PushIntent, {title: string; body: string}> = {
  watchlist: {
    title: "Get a ping when this token moves",
    body: "Turn on alerts for follows, replies, and multiples on tokens you watch. You can change this later in Settings.",
  },
  comment: {
    title: "Know when someone replies",
    body: "Enable notifications so a reply to your comment does not sit unseen. Change this anytime in Settings.",
  },
  follow: {
    title: "Know when someone follows you",
    body: "Enable notifications for new followers and replies. One tap in Settings to mute.",
  },
};

async function registerSw(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/sw.js", {scope: "/"});
}

export function PushPrompt() {
  const user = useUser();
  const session = useSession();
  const [intent, setIntent] = useState<PushIntent | null>(null);
  const [homeScreen, setHomeScreen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    void registerSw().catch((error) => console.error("service worker register failed", error));
    setStandalone(isStandaloneDisplay());
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    const onIntent = (event: Event) => {
      const detail = (event as CustomEvent<PushIntent>).detail;
      if (!user.authenticated) return;
      if (declinedRecently()) return;
      if (typeof Notification !== "undefined" && Notification.permission === "granted") return;
      if (safariNeedsHomeScreen()) {
        setHomeScreen(true);
        setIntent(detail);
        return;
      }
      if (!pushApiAvailable()) return;
      setHomeScreen(false);
      setIntent(detail);
    };
    window.addEventListener("rwa:push-intent", onIntent);
    return () => window.removeEventListener("rwa:push-intent", onIntent);
  }, [user.authenticated]);

  const close = useCallback(() => setIntent(null), []);

  const decline = useCallback(() => {
    markPushDeclined();
    close();
  }, [close]);

  const enable = useCallback(async () => {
    if (homeScreen && !isStandaloneDisplay()) return;
    // First await in this tap handler must be requestPermission (iOS).
    const next = await requestPermissionFromGesture();
    setPermission(next);
    if (next !== "granted") {
      markPushDeclined();
      close();
      return;
    }
    try {
      const result = await savePushSubscription(() => session.getAccessToken(), {test: true});
      if (!result.ok) console.error("push subscribe failed", result.reason);
    } catch (error) {
      console.error("push subscribe failed", error);
    }
    close();
  }, [close, homeScreen, session]);

  const copy = intent ? COPY[intent] : COPY.follow;
  const showBar =
    user.authenticated &&
    standalone &&
    pushApiAvailable() &&
    permission === "default" &&
    !declinedRecently() &&
    !intent;

  return (
    <>
      {showBar ? (
        <div
          data-surface="popup"
          className="pointer-events-auto absolute inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-[40] px-[22px] lg:bottom-10 lg:left-auto lg:right-4 lg:w-[360px] lg:px-0"
        >
          <button
            type="button"
            onClick={() => void enable()}
            className="flex w-full items-center justify-between rounded-2xl bg-surface-popup px-4 py-3 text-left shadow-panel"
          >
            <span className="text-[13.5px] font-bold text-ink">Turn on notifications</span>
            <span className="text-[12px] font-bold text-accent-link">Allow</span>
          </button>
        </div>
      ) : null}
      <Sheet open={Boolean(intent)} onClose={decline} height="auto" label="Notifications">
        <div className="px-5 pb-6 pt-2">
          <h2 className="text-[18px] font-extrabold tracking-[-0.03em]">{copy.title}</h2>
          <p className="mt-2 text-[13.5px] leading-snug text-muted">{copy.body}</p>
          {homeScreen ? (
            <p className="mt-3 text-[13px] leading-snug text-ink">
              On iPhone, add hodl.fan to your Home Screen first (Share → Add to Home Screen), open it from
              there, then tap the button below. Safari only delivers Web Push to installed apps.
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2">
            <Button type="button" variant="green" onClick={() => void enable()}>
              Turn on notifications
            </Button>
            <Button type="button" variant="ghost" onClick={decline}>
              Not now
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
