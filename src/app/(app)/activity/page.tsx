"use client";

import {useEffect, useState} from "react";

import {StickyPageHeader} from "@/components/AppShell";
import {BellList} from "@/components/desktop/Bell";
import {FollowingFeed} from "@/components/desktop/FollowingFeed";
import {UnreadCount} from "@/components/desktop/UnreadCount";
import {useActivity, useAlertPrefs} from "@/hooks/useActivity";
import {unreadBell, unreadFollowing, visibleBell, type BellItem} from "@/lib/alerts";
import {cn} from "@/lib/cn";

/**
 * The phone's Activity tab.
 *
 * Desktop spreads this across two places: the rail's Following tab for what
 * the people you follow are doing, and the bell for what is about you. A phone
 * has room for neither in its chrome, so they are the two halves of one page,
 * built from the same components. Opening a half marks it read.
 */

type Segment = "following" | "you";

export default function ActivityPage() {
  const {activity} = useActivity();
  const {prefs} = useAlertPrefs();
  const [segment, setSegment] = useState<Segment>("following");

  const unread: Record<Segment, number> = {
    following: activity ? unreadFollowing(activity, prefs) : 0,
    you: activity ? unreadBell(activity, prefs) : 0,
  };

  return (
    <div>
      <StickyPageHeader>
        <h1 className="mb-3 text-[30px] font-extrabold leading-none tracking-[-0.035em]">
          Activity
        </h1>
        <div role="tablist" aria-label="Activity" className="-mx-[22px] flex px-[22px]">
          {(
            [
              {value: "following", label: "Following"},
              {value: "you", label: "You"},
            ] as const
          ).map((tab) => {
            const active = tab.value === segment;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSegment(tab.value)}
                // Styled as Home's Watchlist / Tokens / RWAs row, and at least
                // 44px tall to tap.
                className={cn(
                  "relative flex min-h-[44px] flex-1 items-center justify-center gap-1.5 pb-3 pt-1.5",
                  "text-[15px] transition-colors duration-150",
                  active ? "font-extrabold text-ink" : "font-bold text-faint hover:text-muted",
                )}
              >
                {tab.label}
                {/* The half on screen is being read, so it shows no count. */}
                {active ? null : <UnreadCount count={unread[tab.value]} target={tab.value === "you" ? "bell" : "following"} />}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-2 -bottom-px h-[2.5px] rounded-full transition-opacity duration-150",
                    active ? "bg-brand-500 opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </StickyPageHeader>

      <div className="pt-1">
        {segment === "following" ? <FollowingFeed layout="page" /> : <YouFeed />}
      </div>
    </div>
  );
}

/** Replies to your comments and new followers: what the desktop bell holds. */
function YouFeed() {
  const {activity, markSeen} = useActivity();
  const {prefs} = useAlertPrefs();
  const items = activity ? visibleBell(activity, prefs) : [];

  // What was new when this half opened stays marked while it is open: the
  // mark is read once activity has loaded, and only then moved forward.
  const [openedSeenAt, setOpenedSeenAt] = useState<string | null | undefined>(undefined);
  const newest = items[0]?.at ?? null;
  useEffect(() => {
    if (!activity) return;
    if (openedSeenAt === undefined) {
      setOpenedSeenAt(activity.bellSeenAt ?? null);
      return;
    }
    if (newest) markSeen("bell", newest);
  }, [activity, openedSeenAt, newest, markSeen]);

  const isNew = (item: BellItem) =>
    openedSeenAt !== undefined &&
    (!openedSeenAt || Date.parse(item.at) > Date.parse(openedSeenAt));

  return <BellList items={items} isNew={isNew} listClassName="-mx-[22px]" page />;
}
