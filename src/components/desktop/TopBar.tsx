"use client";

import Image from "next/image";
import Link from "next/link";
import {usePathname} from "next/navigation";

import {APP_NAME} from "@/config/app";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {requestCreate} from "@/lib/createIntent";
import {usePrefetchPage} from "@/hooks/usePrefetchPage";
import {SettingsMenu} from "../SettingsMenu";
import {Avatar} from "../ui/Avatar";
import {RocketIcon} from "../ui/Icons";
import {Bell} from "./Bell";
import {SearchBox} from "./SearchBox";

/**
 * The terminal's one row of chrome.
 *
 * Everything the phone spreads across a bottom tab bar and a per-page header
 * lives here instead: where you are, search, launching, and your account. A
 * terminal is used with a cursor and a keyboard, so the targets are sized for
 * those, not for a thumb.
 */

const NAV = [
  // Token and stock pages count as Discover — they are where it leads.
  {href: "/home", label: "Home", match: ["/home"]},
  // A token or RWA page counts as the list it was opened from.
  {href: "/tokens", label: "Tokens", match: ["/tokens", "/token/"]},
  {href: "/rwas", label: "RWAs", match: ["/rwas", "/rwa/"]},
  // News has no tab here: the RWAs page carries the latest stories, and its
  // "See all" still opens /news.
  {href: "/profile", label: "Portfolio", match: ["/profile"]},
] as const;

export function TopBar() {
  const pathname = usePathname() ?? "";
  // A nav link's page data starts on hover, so the click lands on a filled page.
  const warmPage = usePrefetchPage();
  const {displayName, handle, pfpUrl} = useUser();

  return (
    // Three columns with equal flexible sides, so search sits in the middle of
    // the window rather than wherever the nav happens to end. On a narrow
    // window the sides keep their content and search gives up the width.
    <header className="grid h-14 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(240px,460px)_minmax(max-content,1fr)] items-center gap-6 border-b border-[var(--overlay-wash)] bg-surface-base px-[18px]">
      <div className="flex items-center gap-6">
        <Link href="/home" aria-label={`${APP_NAME} home`} className="shrink-0">
          <Image
            src="/brand/logo-white-text.svg"
            alt={APP_NAME}
            width={78}
            height={22}
            priority
            className="h-[22px] w-auto"
          />
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.match.some((prefix) => pathname.startsWith(prefix));
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onMouseEnter={() => warmPage(item.href)}
                onFocus={() => warmPage(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-[7px] text-[13px] font-bold transition-colors",
                  active
                    ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                    : "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <SearchBox />

      <div className="flex items-center justify-end gap-2.5">
        {/* The ETH price lives in the status bar; this spot is for you. */}
        <Bell />

        <button
          type="button"
          onClick={requestCreate}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-brand-500 px-3.5 text-[12.5px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
        >
          <RocketIcon className="h-[15px] w-[15px]" />
          Create
        </button>

        {/* The account pill opens the same settings menu as the gear on a
            phone's profile. Portfolio in the nav is the way to the page. */}
        <SettingsMenu
          trigger={({open, toggle}) => (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label="Account and settings"
              className={cn(
                "inline-flex h-[34px] items-center gap-2 rounded-full pl-[5px] pr-3.5 text-[12.5px] font-extrabold text-ink transition-colors",
                open
                  ? "bg-[var(--overlay-wash-hover)]"
                  : "bg-[var(--bg-input)] hover:bg-[var(--overlay-wash-hover)]",
              )}
            >
              <Avatar name={displayName ?? handle ?? "You"} src={pfpUrl} size={24} />
              <span className="max-w-[120px] truncate">{handle ? `@${handle}` : "Account"}</span>
            </button>
          )}
        />
      </div>
    </header>
  );
}
