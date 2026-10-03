"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {TABS, type TabKey} from "@/config/app";
import {useActivity, useAlertPrefs} from "@/hooks/useActivity";
import {usePrefetchNews} from "@/hooks/useNewsFeed";
import {badgeLabel, followingBadgeCount} from "@/lib/alerts";
import {usePulse} from "@/lib/alertBus";
import {cn} from "@/lib/cn";
import {ActivityIcon, HomeIcon, NewsIcon, SearchIcon, UserIcon} from "./ui/Icons";

const ICONS: Record<TabKey, (props: {className?: string}) => React.JSX.Element> = {
  home: HomeIcon,
  search: SearchIcon,
  activity: ActivityIcon,
  news: NewsIcon,
  profile: UserIcon,
};

/**
 * What is new on the Activity page: activity from people you follow that
 * alerts under Settings → Alerts, plus replies and new followers — the two
 * halves of the page, the same counts desktop puts on its rail tab and bell.
 */
function useFollowingBadge(): number {
  const {activity} = useActivity();
  const {prefs} = useAlertPrefs();
  return followingBadgeCount(activity, prefs);
}

/**
 * The primary navigation.
 *
 * A floating bar rather than a full-width one: it reads as a control sitting
 * over the feed instead of a frame around it, and the content scrolling
 * visibly under its blurred edges is what makes the app feel like a surface
 * rather than a page.
 *
 * Icons only. Five destinations, each with a shape nobody has to read, and the
 * labels stay in `aria-label` for anyone who does need them.
 */
export function TabBar() {
  const pathname = usePathname();
  const prefetchNews = usePrefetchNews();

  /**
   * Which tab to paint as current.
   *
   * `usePathname` only moves once the navigation commits, and these tabs are
   * client pages that fetch on mount — so the highlight used to sit on the old
   * tab for as long as the route took to resolve. The tap read as dropped, and
   * a second tap was the usual response. Paint the pressed tab immediately and
   * let the real pathname take over when it lands.
   */
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => setPressed(null), [pathname]);

  const current = pressed ?? pathname;
  const unread = useFollowingBadge();
  // A pop-up for a trade or a reply pulses the badge, as it does on desktop.
  const beatActivity = usePulse("following");
  const beatBell = usePulse("bell");

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-[22px] bottom-[calc(14px+env(safe-area-inset-bottom))]"
    >
      <div
        data-surface="popup"
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-full p-1.5",
          "bg-surface-popup/80 shadow-panel backdrop-blur-[22px]",
        )}
      >
        {TABS.map((tab) => {
          const Icon = ICONS[tab.key];
          const active =
            current === tab.href ||
            current.startsWith(`${tab.href}/`) ||
            // The Tokens and RWAs lists open from Home's "See all" links.
            (tab.key === "home" && (current === "/tokens" || current === "/rwas"));
          const warm = tab.key === "news" ? prefetchNews : undefined;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              // Every tab is one press away, so keep all five route payloads
              // warm rather than paying an RSC round trip on tap.
              prefetch
              aria-label={
                tab.key === "activity" && unread > 0
                  ? `${tab.label}, ${unread} new`
                  : tab.label
              }
              aria-current={active ? "page" : undefined}
              onPointerDown={() => {
                setPressed(tab.href);
                warm?.();
              }}
              onMouseEnter={warm}
              className={cn(
                "grid h-[46px] w-[54px] place-items-center rounded-full",
                // Snap the highlight on instead of easing it: at 200ms the fade
                // was itself most of the delay people were feeling on tap.
                "transition-[background-color,color,box-shadow] duration-100",
                active
                  ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                  : "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
              )}
            >
              <span className="relative">
                <Icon className="h-[21px] w-[21px]" />
                {tab.key === "activity" && badgeLabel(unread) ? (
                  <span
                    // A new key restarts the pulse.
                    key={beatActivity + beatBell}
                    aria-hidden="true"
                    className={cn(
                      "absolute -right-2.5 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-error px-1 text-[10px] font-extrabold leading-none text-white tabular-nums ring-2 ring-surface-popup",
                      beatActivity + beatBell > 0 && "alert-pulse",
                    )}
                  >
                    {badgeLabel(unread)}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
