"use client";

import {useEffect, useState} from "react";
import {Button} from "@/components/ui/Button";
import {Sheet} from "@/components/ui/Sheet";
import {MILESTONES, type Milestone} from "@/lib/notifications/milestones";
import type {NotificationPrefs} from "@/lib/notifications/prefs";
import {requestPermissionFromGesture, savePushSubscription} from "@/lib/notifications/enablePush";
import {safariNeedsHomeScreen} from "@/lib/notifications/pushClient";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";

function Tick({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-bold",
        on ? "bg-green text-[#04230A]" : "bg-wash text-muted",
      )}
    >
      {label}
    </button>
  );
}

function toggleMultiple(list: Milestone[], step: Milestone): Milestone[] {
  return list.includes(step) ? list.filter((item) => item !== step) : [...list, step].sort((a, b) => a - b);
}

export function NotificationSettings({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    void (async () => {
      const token = await session.getAccessToken();
      if (!token) return;
      const res = await fetch("/api/me/push", {headers: {authorization: `Bearer ${token}`}});
      if (!res.ok) return;
      const data = (await res.json()) as {prefs: NotificationPrefs; configured?: boolean};
      setPrefs(data.prefs);
      if (data.configured === false) setStatus("Push is not configured on the server.");
    })();
  }, [open, session]);

  async function enablePush() {
    if (safariNeedsHomeScreen()) {
      setStatus("Open the Home Screen app first, then tap Allow.");
      return;
    }
    setEnabling(true);
    setStatus(null);
    try {
      const next = await requestPermissionFromGesture();
      setPermission(next);
      if (next !== "granted") {
        setStatus(`Permission is ${next}.`);
        return;
      }
      const result = await savePushSubscription(() => session.getAccessToken(), {test: true});
      if (!result.ok) {
        setStatus(`Subscribe failed (${result.reason ?? "error"}).`);
        return;
      }
      setStatus(result.sent ? "Test notification sent." : "Subscribed. Test did not send.");
    } finally {
      setEnabling(false);
    }
  }

  async function save(next: NotificationPrefs) {
    setPrefs(next);
    setSaving(true);
    try {
      const token = await session.getAccessToken();
      if (!token) return;
      await fetch("/api/me/push", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({prefs: next}),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} height="90%" label="Notifications">
      <div className="space-y-5 px-1 pb-8">
        {!prefs ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : (
          <>
            <Button type="button" variant="green" disabled={enabling} onClick={() => void enablePush()}>
              {permission === "granted" ? "Send test notification" : "Turn on notifications"}
            </Button>
            {status ? <p className="text-[12px] text-muted">{status}</p> : null}
            {safariNeedsHomeScreen() ? (
              <p className="text-[12px] leading-snug text-ink">
                iPhone only prompts inside the Home Screen app, not in Safari.
              </p>
            ) : null}
            <Row
              title="Mute all"
              on={prefs.muted}
              onToggle={() => void save({...prefs, muted: !prefs.muted})}
            />
            <Row
              title="Follows"
              on={prefs.socialFollow}
              onToggle={() => void save({...prefs, socialFollow: !prefs.socialFollow})}
            />
            <Row
              title="Replies"
              on={prefs.socialReply}
              onToggle={() => void save({...prefs, socialReply: !prefs.socialReply})}
            />
            <Row
              title="Holdings multiples"
              on={prefs.holdingsOn}
              onToggle={() => void save({...prefs, holdingsOn: !prefs.holdingsOn})}
            />
            <p className="text-[12px] text-faint">
              Holdings alerts need a real average entry from fills. Until trading writes cost basis they stay quiet.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MILESTONES.map((step) => (
                <Tick
                  key={`h-${step}`}
                  label={`${step}x`}
                  on={prefs.holdingsMultiples.includes(step)}
                  onClick={() =>
                    void save({...prefs, holdingsMultiples: toggleMultiple(prefs.holdingsMultiples, step)})
                  }
                />
              ))}
            </div>
            <Row
              title="Watchlist multiples"
              on={prefs.watchlistOn}
              onToggle={() => void save({...prefs, watchlistOn: !prefs.watchlistOn})}
            />
            <div className="flex flex-wrap gap-1.5">
              {MILESTONES.map((step) => (
                <Tick
                  key={`w-${step}`}
                  label={`${step}x`}
                  on={prefs.watchlistMultiples.includes(step)}
                  onClick={() =>
                    void save({
                      ...prefs,
                      watchlistMultiples: toggleMultiple(prefs.watchlistMultiples, step),
                    })
                  }
                />
              ))}
            </div>
            <label className="block text-[12px] font-semibold text-muted">
              Minimum position
              <input
                type="number"
                min={0}
                value={prefs.minPositionUsd}
                onChange={(event) =>
                  void save({...prefs, minPositionUsd: Math.max(0, Number(event.target.value) || 0)})
                }
                className="mt-1 w-full rounded-[12px] border border-hairline bg-wash px-3 py-2 text-[14px] text-ink"
              />
            </label>
            <label className="block text-[12px] font-semibold text-muted">
              Quiet hours (your timezone)
              <div className="mt-1 flex gap-2">
                <input
                  type="time"
                  value={prefs.quietStart ?? ""}
                  onChange={(event) => void save({...prefs, quietStart: event.target.value || null})}
                  className="flex-1 rounded-[12px] border border-hairline bg-wash px-3 py-2 text-[14px] text-ink"
                />
                <input
                  type="time"
                  value={prefs.quietEnd ?? ""}
                  onChange={(event) => void save({...prefs, quietEnd: event.target.value || null})}
                  className="flex-1 rounded-[12px] border border-hairline bg-wash px-3 py-2 text-[14px] text-ink"
                />
              </div>
            </label>
            <p className="text-[11px] text-faint">{saving ? "Saving…" : "Changes save as you tap."}</p>
            <Button type="button" variant="ghost" onClick={onClose}>
              Done
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Row({title, on, onToggle}: {title: string; on: boolean; onToggle: () => void}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between py-1 text-left"
    >
      <span className="text-[15px] font-bold">{title}</span>
      <span
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors",
          on ? "bg-green" : "bg-wash",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
