"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {TABS, type TabKey} from "@/config/app";
import {cn} from "@/lib/cn";
import {HomeIcon, StarIcon, WalletIcon} from "./ui/Icons";

const ICONS: Record<TabKey, (props: {className?: string}) => JSX.Element> = {
  home: HomeIcon,
  watchlist: StarIcon,
  profile: WalletIcon,
};

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="absolute inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-card/90 px-2 pt-[9px] backdrop-blur-[16px] pb-[calc(9px+env(safe-area-inset-bottom))]"
    >
      {TABS.map((tab) => {
        const Icon = ICONS[tab.key];
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-[5px] py-1.5 transition-colors duration-200",
              active ? "text-green-deep" : "text-faint",
            )}
          >
            <Icon className="h-[22px] w-[22px]" />
            <span className="text-[10.5px] font-bold">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
