"use client";

import {cn} from "@/lib/cn";
import {TIMEFRAMES, type Timeframe} from "@/lib/types";

/**
 * Timeframe pills under the chart. Swipeable on a phone and clickable
 * everywhere, so the rail scrolls rather than wrapping onto a second line.
 */
export function TimeframeRail({
  value,
  onChange,
  positive,
  className,
}: {
  value: Timeframe;
  onChange: (value: Timeframe) => void;
  /** Active pill picks up the direction of the window, as a brokerage would. */
  positive: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Chart timeframe"
      className={cn(
        "rail flex gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5",
        className,
      )}
    >
      {TIMEFRAMES.map((tf) => {
        const active = tf === value;
        return (
          <button
            key={tf}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tf)}
            className={cn(
              "shrink-0 rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors duration-150",
              active
                ? positive
                  ? "bg-[rgba(0,200,5,0.12)] text-green-deep"
                  : "bg-[rgba(255,90,82,0.11)] text-red"
                : "text-faint hover:text-muted",
            )}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}
