import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline bg-card shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function SectionLabel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mx-0.5 mb-3 mt-5 text-[11px] font-bold tracking-[0.09em] text-faint",
        className,
      )}
      {...props}
    />
  );
}
