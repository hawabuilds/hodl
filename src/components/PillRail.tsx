"use client";

import {cn} from "@/lib/cn";

/**
 * A compact row of window pills — chart timeframes and portfolio ranges.
 *
 * Separate from `FilterRail`: those chips filter a list and are read as
 * options, these switch the window under a chart and take their colour from
 * the direction of that window, the way a brokerage tints them.
 */
export function PillRail<T extends string>({
  options,
  value,
  onChange,
  positive,
  label,
  className,
  resolvedValue,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  positive: boolean;
  label: string;
  className?: string;
  /** Bucket actually drawn when the ladder stepped down from `value`. */
  resolvedValue?: T | null;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "rail flex gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option === value;
        const shown =
          active && resolvedValue && resolvedValue !== option
            ? `${option} · ${resolvedValue}`
            : option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors duration-150",
              active
                ? positive
                  ? "bg-[rgb(61_219_168/12%)] text-price-up"
                  : "bg-[rgb(255_107_122/11%)] text-price-down"
                : "text-faint hover:text-muted",
            )}
          >
            {shown}
          </button>
        );
      })}
    </div>
  );
}
