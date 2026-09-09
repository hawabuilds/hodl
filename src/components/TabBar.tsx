"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {TABS, type TabKey} from "@/config/app";
import {usePrefetchNews} from "@/hooks/usePrefetchNews";
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

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-[22px] bottom-[calc(14px+env(safe-area-inset-bottom))]"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-full p-1.5",
          "bg-surface-elevated/80 shadow-panel backdrop-blur-[22px]",
        )}
      >
        {TABS.map((tab) => {
          const Icon = ICONS[tab.key];
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              onPointerDown={tab.key === "news" ? prefetchNews : undefined}
              onMouseEnter={tab.key === "news" ? prefetchNews : undefined}
              className={cn(
                "grid h-[46px] w-[54px] place-items-center rounded-full",
                "transition-[background-color,color,box-shadow] duration-200",
                active
                  ? "bg-surface-elevated text-ink shadow-tab-active"
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
