"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "dark" | "green" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  dark: "bg-btn-dark text-btn-dark-fg shadow-dark hover:-translate-y-0.5 hover:shadow-[0_24px_46px_-16px_rgba(0,200,5,0.48)]",
  green: "bg-green text-[#04230A] shadow-green hover:-translate-y-0.5",
  ghost: "bg-transparent text-muted hover:bg-wash",
  outline: "bg-card text-ink border border-hairline hover:-translate-y-px",
};

const sizes: Record<Size, string> = {
  sm: "px-4 py-2.5 text-[13px] rounded-pill",
  md: "px-4 py-3.5 text-[15px] rounded-[15px]",
  lg: "px-5 py-[18px] text-[16px] rounded-[17px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "dark", size = "md", fullWidth, className, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2.5 font-bold tracking-[-0.01em]",
          "transition-[transform,box-shadow,background-color,color] duration-200",
          "disabled:pointer-events-none disabled:bg-wash disabled:text-faint disabled:shadow-none",
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
