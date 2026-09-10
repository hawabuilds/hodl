"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedToggleProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedToggleProps<T>) {
  return (
    <div
      role="group"
      className={cn(
        "flex gap-1 rounded-2xl bg-[var(--segment-track)] p-1 shadow-inset-soft",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "grid place-items-center rounded-xl transition-[background-color,color,box-shadow] duration-150",
              option.icon ? "h-[26px] w-[30px]" : "h-[26px] px-3 text-[12px] font-bold",
              active
                ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                : "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
            )}
          >
            {option.icon ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
