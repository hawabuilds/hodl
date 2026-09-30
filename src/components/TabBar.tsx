"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {TABS, type TabKey} from "@/config/app";
import {usePrefetchNews} from "@/hooks/useNewsFeed";
import {cn} from "@/lib/cn";
import {HomeIcon, NewsIcon, SearchIcon, UserIcon} from "./ui/Icons";

const ICONS: Record<TabKey, (props: {className?: string}) => JSX.Element> = {
  home: HomeIcon,
  search: SearchIcon,
  news: NewsIcon,
  profile: UserIcon,
};

/**
 * The primary navigation.
 *
 * A floating bar rather than a full-width one: it reads as a control sitting
 * over the feed instead of a frame around it, and the content scrolling
 * visibly under its blurred edges is what makes the app feel like a surface
 * rather than a page.
 *
 * Icons only. Four destinations, each with a shape nobody has to read, and the
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
              // Every tab is one press away, so keep all four route payloads
              // warm rather than paying an RSC round trip on tap.
              prefetch
              aria-label={tab.label}
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
              <Icon className="h-[21px] w-[21px]" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
