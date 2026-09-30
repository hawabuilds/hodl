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
import {OverlayPortal} from "../ui/OverlayPortal";
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

/** Pop-ups on a phone last a second less: the screen is smaller and busier. */
const PHONE_TOAST_MS = 4_000;

/**
 * `desktop`: bottom-left above the status bar, up to three, hover to pause.
 * `phone`: one at a time at the top of the screen, smaller, gone after four
 * seconds or a swipe up. The rules behind them — what pops up, grouping,
 * Settings → Alerts, holding off during a trade — are the same.
 */
export type ToastsLayout = "desktop" | "phone";

export function Toasts({layout = "desktop"}: {layout?: ToastsLayout} = {}) {
  const phone = layout === "phone";
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
        // Trades live under Following: on a phone, the Activity page; on
        // desktop, the rail — already there on a token page, and otherwise
        // the token's page with it open.
        if (phone) {
          router.push("/activity");
          return;
        }
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
    [close, pathname, phone, router],
  );

  if (state.toasts.length === 0) return null;

  if (phone) {
    // One at a time: the newest. Closing it closes the ones it replaced, so
    // an older pop-up never surfaces after the newer one has gone.
    const newest = state.toasts[state.toasts.length - 1]!;
    return (
      <OverlayPortal>
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-[60] flex justify-center px-[22px]"
        >
          <ToastCard
            key={newest.id}
            toast={newest}
            onOpen={open}
            onClose={() => setState(EMPTY_TOASTS)}
            phone
          />
        </div>
      </OverlayPortal>
    );
  }

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
  phone = false,
}: {
  toast: Toast;
  onOpen: (toast: Toast) => void;
  onClose: (id: string) => void;
  phone?: boolean;
}) {
  const lifetime = phone ? PHONE_TOAST_MS : TOAST_MS;
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(lifetime);
  const startedAt = useRef(0);
  // Swipe up to dismiss: how far the finger has dragged the card, in px.
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  // A group that grows starts its time again.
  useEffect(() => {
    remaining.current = lifetime;
  }, [toast.shownAt, lifetime]);

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

  const swipe = phone
    ? {
        onPointerDown: (event: React.PointerEvent) => {
          dragStart.current = event.clientY;
          setHovered(true);
        },
        onPointerMove: (event: React.PointerEvent) => {
          if (dragStart.current == null) return;
          setDragY(Math.min(0, event.clientY - dragStart.current));
        },
        onPointerUp: () => {
          const dragged = dragY;
          dragStart.current = null;
          setHovered(false);
          if (dragged < -24) onClose(toast.id);
          else setDragY(0);
        },
        onPointerCancel: () => {
          dragStart.current = null;
          setHovered(false);
          setDragY(0);
        },
      }
    : {};

  return (
    <div
      role="status"
      data-surface="popup"
      onMouseEnter={phone ? undefined : () => setHovered(true)}
      onMouseLeave={phone ? undefined : () => setHovered(false)}
      {...swipe}
      style={
        phone
          ? {
              transform: dragY ? `translateY(${dragY}px)` : undefined,
              opacity: dragY ? Math.max(0.2, 1 + dragY / 80) : undefined,
              touchAction: "none",
            }
          : undefined
      }
      className={cn(
        "pointer-events-auto flex animate-rise items-center rounded-2xl border border-[var(--overlay-wash-hover)] bg-[var(--bg-input)] shadow-panel",
        phone ? "w-full max-w-[386px] gap-2 py-1 pl-2.5 pr-1" : "gap-2.5 py-2.5 pl-3 pr-2",
        dragStart.current == null && "transition-[transform,opacity] duration-150",
      )}
    >
      <button
        type="button"
        onClick={() => {
          // A swipe that ended over the card is not a tap.
          if (!dragY) onOpen(toast);
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center text-left",
          phone ? "min-h-[44px] gap-2" : "gap-2.5",
        )}
      >
        <PersonAvatar person={item.person} size={phone ? 26 : 30} />
        <span className={cn("min-w-0 flex-1 leading-[1.35]", phone ? "text-[12.5px]" : "text-[13px]")}>
          {toast.group ? (
            <span className="line-clamp-2 font-bold">{groupToastText(toast.kind, toast.count)}</span>
          ) : (
            <ToastText kind={toast.kind} item={toast.item} />
          )}
        </span>
        {"asset" in item ? <AssetLogo asset={item.asset} size={phone ? 22 : 26} /> : null}
      </button>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss"
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink",
          phone ? "h-11 w-11" : "h-6 w-6",
        )}
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
