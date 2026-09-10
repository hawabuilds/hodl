"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./Icons";
import { OverlayPortal } from "./OverlayPortal";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Drops the white card chrome so callers can supply their own surface. */
  bare?: boolean;
  /** Near-black terminal popup — stays dark in legacy palette and light mode. */
  surface?: "elevated" | "popup";
  closeTone?: "light" | "dark";
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  bare,
  surface = "popup",
  closeTone = "light",
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <OverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className={cn(
          "absolute inset-0 z-50 flex items-center justify-center p-[22px]",
          "bg-[var(--backdrop-scrim)] backdrop-blur-[7px] transition-opacity duration-300",
          open
            ? "visible opacity-100 pointer-events-auto"
            : "invisible pointer-events-none opacity-0",
        )}
      >
        <div
          data-surface={surface === "popup" ? "popup" : undefined}
          className={cn(
            "relative max-h-[92%] w-full max-w-[366px] overflow-y-auto scroll-quiet",
            "transition-[transform,opacity] duration-300 ease-sheet",
            open ? "scale-100 opacity-100" : "scale-[0.93] opacity-40",
            !bare &&
              surface === "popup" &&
              "rounded-2xl bg-surface-popup p-6 pt-[30px] shadow-modal",
            !bare &&
              surface !== "popup" &&
              "rounded-2xl bg-surface-elevated p-6 pt-[30px] shadow-modal",
            bare && "rounded-[26px] shadow-modal",
            className,
          )}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "absolute right-4 top-4 z-[2] grid h-8 w-8 place-items-center rounded-full transition-colors",
              closeTone === "light"
                ? "bg-[var(--overlay-wash)] text-muted hover:bg-[var(--overlay-wash-hover)]"
                : "bg-white/[0.14] text-white hover:bg-white/25",
            )}
          >
            <CloseIcon className="h-[15px] w-[15px]" />
          </button>
          {title && (
            <h2 className="mb-[22px] text-center text-[22px] font-extrabold tracking-[-0.03em] text-ink">
              {title}
            </h2>
          )}
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}
