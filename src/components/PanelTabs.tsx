"use client";

import {cn} from "@/lib/cn";

export interface PanelTab<T extends string> {
  value: T;
  label: string;
}

/**
 * The underlined tab row beneath a chart. Selection is carried by the rule and
 * the weight change, not by colour alone.
 */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: PanelTab<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Asset detail"
      className="flex"
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative flex-1 pb-2.5 pt-1 text-[13px] transition-colors duration-150",
              active ? "font-extrabold text-ink" : "font-bold text-faint hover:text-muted",
            )}
          >
            {tab.label}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-3 -bottom-px h-[2px] rounded-full transition-opacity duration-150",
                active ? "bg-brand-500 opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
