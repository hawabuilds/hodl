"use client";

import {useEffect, useRef, type ReactNode} from "react";
import {cn} from "@/lib/cn";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label in a lighter weight, e.g. a match count. */
  hint?: string;
  title?: string;
  disabled?: boolean;
}

interface FilterRailProps<T extends string> {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Slot at the head of the rail, used for the sort control on the feed. */
  lead?: ReactNode;
  className?: string;
}

/**
 * A horizontal rail of filter chips.
 *
 * Every filter row in the app is one of these — the feed's sort, the RWA sector
 * list, the portfolio's asset split — so they scroll, wrap and highlight
 * identically no matter how many options each one has.
 */
export function FilterRail<T extends string>({
  options,
  value,
  onChange,
  label,
  lead,
  className,
}: FilterRailProps<T>) {
  const railRef = useRef<HTMLDivElement>(null);

  // A chip chosen from far down the rail has to stay visible once the list
  // below it re-renders, otherwise the only cue for what is filtered is
  // scrolled off the edge of the screen.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const active = rail.querySelector('[aria-pressed="true"]');
    if (!active) return;
    if (active === rail.firstElementChild) {
      rail.scrollTo({left: 0, behavior: "smooth"});
      return;
    }
    active.scrollIntoView({behavior: "smooth", block: "nearest", inline: "center"});
  }, [value]);

  return (
    <div
      ref={railRef}
      role="group"
      aria-label={label}
      className={cn(
        "rail -mx-[22px] flex items-center gap-2 overflow-x-auto overscroll-x-contain px-[22px]",
        className,
      )}
    >
      {lead}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            disabled={option.disabled && !active}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-[12px] px-3.5 py-2 text-[13.5px] leading-none",
              "transition-[background-color,color,opacity] duration-150",
              active
                ? "bg-[var(--overlay-wash-hover)] font-extrabold text-ink"
                : "bg-[var(--overlay-wash)] font-semibold text-faint hover:text-muted",
              option.disabled && !active && "cursor-not-allowed opacity-40",
            )}
          >
            {option.label}
            {option.hint ? (
              <span
                className={cn(
                  "tnum ml-1.5 text-[11.5px] font-semibold",
                  active ? "text-muted" : "text-faint",
                )}
              >
                {option.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
