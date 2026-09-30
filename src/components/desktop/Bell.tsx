"use client";

import {useEffect, useRef, useState} from "react";

import {useActivity, useAlertPrefs} from "@/hooks/useActivity";
import {useUser} from "@/hooks/useUser";
import {unreadBell, visibleBell, type BellItem} from "@/lib/alerts";
import {announceCommentTarget, commentHash} from "@/lib/alertBus";
import {cn} from "@/lib/cn";
import {relativeTime} from "@/lib/format";
import {AssetLink} from "../AssetLink";
import {BellIcon} from "../ui/Icons";
import {AssetChip, PersonAvatar, ProfileLink} from "./FollowingFeed";
import {UnreadCount} from "./UnreadCount";

/**
 * Things about you, and only those: replies to your comments and new
 * followers. What the people you follow do lives in the rail's Following tab,
 * not here, so the bell stays quiet enough to mean something.
 */
export function Bell() {
  const {activity, markSeen} = useActivity();
  const {prefs} = useAlertPrefs();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const items = activity ? visibleBell(activity, prefs) : [];
  const unread = activity ? unreadBell(activity, prefs) : 0;
  const seenAt = activity?.bellSeenAt ?? null;
  // What was new when the panel opened stays marked while it is open.
  const [openedSeenAt, setOpenedSeenAt] = useState<string | null>(null);

  const newest = items[0]?.at ?? null;
  useEffect(() => {
    if (open && newest) markSeen("bell", newest);
  }, [open, newest, markSeen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  const isNew = (item: BellItem) =>
    !openedSeenAt || Date.parse(item.at) > Date.parse(openedSeenAt);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!open) setOpenedSeenAt(seenAt);
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className={cn(
          "relative grid h-[34px] w-[34px] place-items-center rounded-full transition-colors",
          open
            ? "bg-[var(--overlay-wash-hover)] text-ink"
            : "bg-[var(--bg-input)] text-muted hover:bg-[var(--overlay-wash-hover)] hover:text-ink",
        )}
      >
        <BellIcon className="h-[17px] w-[17px]" />
        <UnreadCount
          count={unread}
          target="bell"
          className="absolute -right-1 -top-1 ring-2 ring-surface-base"
        />
      </button>

      <div
        role="dialog"
        aria-label="Notifications"
        data-surface="popup"
        className={cn(
          "absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] overflow-hidden rounded-2xl bg-surface-popup shadow-panel",
          "origin-top-right transition-[opacity,transform,visibility] duration-150",
          open ? "visible scale-100 opacity-100" : "invisible pointer-events-none scale-[0.96] opacity-0",
        )}
      >
        <h2 className="px-4 pb-2 pt-3.5 text-[14px] font-extrabold tracking-[-0.01em]">Notifications</h2>
        <BellList
          items={items}
          isNew={isNew}
          onGo={() => setOpen(false)}
          listClassName="scroll-quiet max-h-[min(460px,calc(100dvh-120px))] overflow-y-auto pb-1.5"
        />
      </div>
    </div>
  );
}

/**
 * Replies to your comments and new followers, or why there are none. The bell's
 * panel on desktop and the You half of the phone's Following page.
 */
export function BellList({
  items,
  isNew,
  onGo,
  listClassName,
  page = false,
}: {
  items: BellItem[];
  isNew: (item: BellItem) => boolean;
  onGo?: () => void;
  listClassName?: string;
  /** A phone page: rows run to the screen's edges like its other lists. */
  page?: boolean;
}) {
  const user = useUser();
  if (!user.authenticated) {
    return (
      <div className="px-4 pb-5 pt-2 text-center">
        <p className="text-[12.5px] font-medium leading-[1.5] text-faint">
          Sign in to see replies to your comments and new followers.
        </p>
        <button
          type="button"
          onClick={() => user.login()}
          className="mt-3 inline-flex h-[32px] items-center rounded-full bg-brand-500 px-4 text-[12.5px] font-extrabold text-white"
        >
          Sign in
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="px-4 pb-6 pt-3 text-center text-[12.5px] font-medium leading-[1.5] text-faint">
        Replies to your comments and new followers show up here.
      </p>
    );
  }
  return (
    <ul className={listClassName}>
      {items.map((item) => (
        <li key={`${item.type}:${item.id}`}>
          <BellRow item={item} fresh={isNew(item)} onGo={onGo} page={page} />
        </li>
      ))}
    </ul>
  );
}

function BellRow({
  item,
  fresh,
  onGo,
  page,
}: {
  item: BellItem;
  fresh: boolean;
  onGo?: () => void;
  page: boolean;
}) {
  const className = cn(
    "flex items-start gap-2.5 transition-colors hover:bg-[var(--overlay-wash)]",
    page ? "px-[22px] py-3" : "px-4 py-2.5",
    fresh && "bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]",
  );
  const time = (
    <time dateTime={item.at} className="ml-auto shrink-0 pl-1.5 text-[11px] font-medium text-faint">
      {relativeTime(item.at)}
    </time>
  );

  if (item.type === "follow") {
    return (
      <ProfileLink handle={item.person.handle} className={className} onClick={onGo}>
        <PersonAvatar person={item.person} size={32} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 pt-1.5 text-[13px] leading-[1.35]">
          <span className="truncate font-extrabold">@{item.person.handle}</span>
          <span className="shrink-0 font-semibold text-muted">followed you</span>
          {time}
        </span>
      </ProfileLink>
    );
  }

  const hash = commentHash(item.id);
  return (
    <AssetLink
      kind={item.asset.kind}
      id={item.asset.id}
      hash={hash}
      onClick={() => {
        announceCommentTarget(hash);
        onGo?.();
      }}
      className={className}
    >
      <PersonAvatar person={item.person} size={32} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1 text-[13px] leading-[1.35]">
          <span className="truncate font-extrabold">@{item.person.handle}</span>
          <span className="shrink-0 font-semibold text-muted">replied to you</span>
          {time}
        </span>
        <span className="mt-0.5 line-clamp-2 break-words text-[12.5px] leading-[1.4] text-muted">
          {item.body}
        </span>
        <AssetChip asset={item.asset} className="mt-1.5" />
      </span>
    </AssetLink>
  );
}
