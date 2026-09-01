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
        "flex gap-0.5 rounded-[10px] border border-hairline bg-wash p-[3px]",
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
              "grid place-items-center rounded-[7px] transition-all duration-150",
              option.icon ? "h-[26px] w-[30px]" : "h-[26px] px-3 text-[12px] font-bold",
              active
                ? "bg-card text-ink shadow-[0_2px_6px_-3px_rgba(9,24,14,0.3)]"
                : "text-faint",
            )}
          >
            {option.icon ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
