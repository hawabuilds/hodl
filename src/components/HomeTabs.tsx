"use client";

import {cn} from "@/lib/cn";
import {StarIcon} from "./ui/Icons";

export type HomeTab = "watchlist" | "tokens" | "rwas";

const TABS: {value: HomeTab; label: string}[] = [
  {value: "watchlist", label: "Watchlist"},
  {value: "tokens", label: "Tokens"},
  {value: "rwas", label: "RWAs"},
];

/**
 * The feed's top-level split.
 *
 * Underlined rather than a segmented control: these are three views of the
 * market, not three settings, and the rule under the active one carries that
 * without boxing the row.
 */
export function HomeTabs({
  value,
  onChange,
}: {
  value: HomeTab;
  onChange: (value: HomeTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Market"
      className="-mx-[22px] flex border-b border-hairline px-[22px]"
    >
      {TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 pb-3 pt-1.5",
              "text-[15px] transition-colors duration-150",
              active ? "font-extrabold text-ink" : "font-bold text-faint hover:text-muted",
            )}
          >
            {tab.value === "watchlist" ? (
              <StarIcon className="h-[17px] w-[17px]" />
            ) : null}
            {tab.label}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-2 -bottom-px h-[2.5px] rounded-full transition-opacity duration-150",
                active ? "bg-green opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
