"use client";

import type {ReactNode} from "react";

import {cn} from "@/lib/cn";

/**
 * One live list in the terminal: a title, how many there are, the few ways to
 * cut it, and the list itself scrolling on its own.
 *
 * Each column scrolls independently rather than the page scrolling as a whole.
 * That is the point of putting lists side by side: you can be deep in New while
 * Trending stays where you left it.
 */
export function BoardColumn({
  title,
  count,
  controls,
  children,
  className,
}: {
  /** Omitted when the controls already name the list, as in the rail. */
  title?: ReactNode;
  count?: number;
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base",
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--overlay-wash)] px-3.5 pb-2.5 pt-3">
        {title || typeof count === "number" ? (
          <h2 className="flex min-w-0 items-center gap-[7px] text-[14px] font-extrabold tracking-[-0.01em]">
            {title ? <span className="truncate">{title}</span> : null}
            {typeof count === "number" ? (
              <span className="tabular-nums rounded-full bg-[var(--overlay-wash)] px-[7px] py-[2px] text-[11px] font-bold text-faint">
                {count}
              </span>
            ) : null}
          </h2>
        ) : null}
        {controls}
      </header>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function LiveDot({className}: {className?: string}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-price-up shadow-[0_0_0_3px_rgb(61_219_168/18%)]",
        className,
      )}
    />
  );
}

/** A compact segmented control for a column header. */
export function ColumnSegments<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
}: {
  options: readonly {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** `sm` sits in a column header; `md` filters a whole page. */
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex shrink-0 gap-0.5 rounded-full bg-[var(--segment-track)]",
        size === "md" ? "p-[3px]" : "p-[2px]",
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "whitespace-nowrap rounded-full font-extrabold transition-colors",
            size === "md" ? "px-3 py-1.5 text-[12px]" : "px-[9px] py-1 text-[11px]",
            value === option.value
              ? "bg-[var(--bg-input)] text-ink"
              : "text-faint hover:text-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** What an empty or loading column says, instead of a blank rectangle. */
export function ColumnNote({children}: {children: ReactNode}) {
  return (
    <p className="px-4 py-10 text-center text-[12.5px] font-medium leading-[1.5] text-faint">
      {children}
    </p>
  );
}
