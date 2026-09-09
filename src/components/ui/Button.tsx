"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "primaryAlt" | "dark" | "green" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-brand hover:bg-brand-600 hover:-translate-y-0.5",
  /** Screenshot comparison: AA-compliant white-on-#524BD4 */
  primaryAlt:
    "bg-brand-600 text-white shadow-brand hover:bg-brand-700 hover:-translate-y-0.5",
  dark: "bg-brand-500 text-white shadow-brand hover:bg-brand-600 hover:-translate-y-0.5",
  green:
    "bg-price-up text-[var(--surface-pressed)] shadow-price-up hover:-translate-y-0.5",
  ghost: "bg-transparent text-muted hover:bg-[var(--overlay-wash)]",
  outline:
    "bg-[var(--overlay-wash)] text-ink hover:-translate-y-px hover:bg-[var(--overlay-wash-hover)]",
};

const sizes: Record<Size, string> = {
  sm: "px-4 py-2.5 text-[13px] rounded-pill min-h-[36px]",
  md: "px-4 py-3.5 text-[15px] rounded-[15px] min-h-[44px]",
  lg: "px-5 py-[18px] text-[16px] rounded-[17px] min-h-[52px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", fullWidth, className, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2.5 font-bold tracking-[-0.01em]",
          "transition-[transform,box-shadow,background-color,color] duration-200",
          "disabled:pointer-events-none disabled:bg-surface-hover disabled:text-text-disabled disabled:shadow-none",
          variants[variant],
          sizes[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      />
    );
  },
);
