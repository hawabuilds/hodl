"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {usePathname, useRouter} from "next/navigation";

import {useActivity, useAlertPrefs} from "@/hooks/useActivity";
import {useUser} from "@/hooks/useUser";
import {
  EMPTY_TOASTS,
  TOAST_MS,
  dismissToast,
  followingAlerts,
  groupToastText,
  pushToasts,
  tradeUsdLabel,
  type BellItem,
  type FollowingItem,
  type Toast,
  type ToastKind,
  type ToastState,
} from "@/lib/alerts";
import {
  announceCommentTarget,
  commentHash,
  pulse,
  setRailList,
  tradeInProgress,
} from "@/lib/alertBus";
import {cn} from "@/lib/cn";
import {assetPath} from "@/lib/routes";
import {CloseIcon} from "../ui/Icons";
import {AssetLogo, PersonAvatar} from "./FollowingFeed";

/**
 * Pop-ups for trades by people you follow and replies to your comments.
 *
 * Bottom-left, just above the status bar: the ticket is on the right, so they
 * never cover it. They are dropped — not queued — while pop-ups are switched
 * off, while the cursor is in the ticket's amount box, or while a trade is
 * confirming; the Following count and the bell still carry them.
 */

/** A row older than this that turns up late (a new follow, say) is history, not news. */
const FRESH_MS = 10 * 60_000;

export function Toasts() {
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const {activity} = useActivity();
  const {prefs} = useAlertPrefs();
  const [state, setState] = useState<ToastState>(EMPTY_TOASTS);

  // Everything already on the first read is old news; only what arrives after
  // it can pop up.
  const seen = useRef<Set<string> | null>(null);
  const owner = useRef<string | null>(null);
  const userId = user.user?.id ?? null;

  useEffect(() => {
    if (owner.current !== userId) {
      owner.current = userId;
      seen.current = null;
      setState(EMPTY_TOASTS);
    }
    if (!activity) return;

    const keys = [
      ...activity.following.map((item) => `f:${item.id}`),
      ...activity.bell.map((item) => `b:${item.id}`),
    ];
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    const known = seen.current;
    const now = Date.now();
    const recent = (at: string) => now - Date.parse(at) < FRESH_MS;

    // Oldest first, so the newest ends up on top and as a group's target.
    const trades = activity.following
      .filter((item) => !known.has(`f:${item.id}`))
      .filter((item) => item.type === "trade" && recent(item.at) && followingAlerts(item, prefs))
      .reverse();
    const replies = activity.bell
      .filter((item) => !known.has(`b:${item.id}`))
      .filter((item) => item.type === "reply" && recent(item.at) && prefs.replies)
      .reverse();
    for (const key of keys) known.add(key);

    if (!prefs.popups || tradeInProgress()) return;
    const incoming = [
      ...trades.map((item) => ({kind: "trade" as const, item})),
      ...replies.map((item) => ({kind: "reply" as const, item})),
    ];
    if (incoming.length === 0) return;
    setState((current) => pushToasts(current, incoming, now));
    if (trades.length > 0) pulse("following");
    if (replies.length > 0) pulse("bell");
  }, [activity, prefs, userId]);

  // Switching pop-ups off clears what is already up.
  useEffect(() => {
    if (!prefs.popups) setState(EMPTY_TOASTS);
  }, [prefs.popups]);

  const close = useCallback((id: string) => setState((current) => dismissToast(current, id)), []);

  const open = useCallback(
    (toast: Toast) => {
      close(toast.id);
      const item = toast.group ? toast.latest : toast.item;
      if (toast.kind === "trade") {
        // The Following tab is where trades live. On a token page the rail is
        // already there; anywhere else, go to the token with it open.
        setRailList("following");
        const onAsset = pathname.startsWith("/token/") || pathname.startsWith("/rwa/");
        if (!onAsset && "asset" in item) router.push(assetPath(item.asset.kind, item.asset.id));
        return;
      }
      if (item.type === "reply") {
        const hash = commentHash(item.id);
        router.push(`${assetPath(item.asset.kind, item.asset.id)}#${hash}`);
        announceCommentTarget(hash);
      }
    },
    [close, pathname, router],
  );

  if (state.toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-[38px] left-3 z-[60] flex w-[320px] flex-col-reverse gap-2"
    >
      {/* Newest at the bottom, nearest the status bar. */}
      {[...state.toasts].reverse().map((toast) => (
        <ToastCard key={toast.id} toast={toast} onOpen={open} onClose={close} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onOpen,
  onClose,
}: {
  toast: Toast;
  onOpen: (toast: Toast) => void;
  onClose: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(TOAST_MS);
  const startedAt = useRef(0);

  // A group that grows starts its five seconds again.
  useEffect(() => {
    remaining.current = TOAST_MS;
  }, [toast.shownAt]);

  useEffect(() => {
    if (hovered) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onClose(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [hovered, onClose, toast.id, toast.shownAt]);

  const item = toast.group ? toast.latest : toast.item;

  return (
    <div
      role="status"
      data-surface="popup"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="pointer-events-auto flex animate-rise items-center gap-2.5 rounded-2xl border border-[var(--overlay-wash-hover)] bg-[var(--bg-input)] py-2.5 pl-3 pr-2 shadow-panel"
    >
      <button
        type="button"
        onClick={() => onOpen(toast)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <PersonAvatar person={item.person} size={30} />
        <span className="min-w-0 flex-1 text-[13px] leading-[1.35]">
          {toast.group ? (
            <span className="line-clamp-2 font-bold">{groupToastText(toast.kind, toast.count)}</span>
          ) : (
            <ToastText kind={toast.kind} item={toast.item} />
          )}
        </span>
        {"asset" in item ? <AssetLogo asset={item.asset} size={26} /> : null}
      </button>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function ToastText({kind, item}: {kind: ToastKind; item: FollowingItem | BellItem}) {
  if (kind === "trade" && item.type === "trade") {
    const size = tradeUsdLabel(item.usd);
    return (
      <span className="line-clamp-2">
        <b className="font-extrabold">@{item.person.handle}</b>{" "}
        <span className={cn("font-bold", item.side === "buy" ? "text-price-up" : "text-price-down")}>
          {item.side === "buy" ? "bought" : "sold"}
        </span>{" "}
        {size ? `${size} of ` : ""}
        <b className="font-extrabold">{item.asset.symbol}</b>
      </span>
    );
  }
  if (item.type === "reply") {
    return (
      <span className="line-clamp-2">
        <b className="font-extrabold">@{item.person.handle}</b>{" "}
        <span className="text-muted">replied: {item.body}</span>
      </span>
    );
  }
  return null;
}
