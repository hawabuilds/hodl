"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./Icons";
import { OverlayPortal } from "./OverlayPortal";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Sheet height as a percentage of the frame. */
  height?: "80%" | "90%" | "auto";
  /** Near-black terminal popup — stays dark in legacy palette and light mode. */
  surface?: "elevated" | "popup";
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  label?: string;
}

export function Sheet({
  open,
  onClose,
  height = "90%",
  surface = "popup",
  header,
  footer,
  children,
  label,
}: SheetProps) {
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
        aria-label={label}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className={cn(
          "absolute inset-0 z-[55] flex items-end justify-center",
          "bg-[var(--backdrop-scrim)] backdrop-blur-[6px] transition-opacity duration-300",
          open
            ? "visible opacity-100 pointer-events-auto"
            : "invisible pointer-events-none opacity-0",
        )}
      >
        <div
          data-surface={surface === "popup" ? "popup" : undefined}
          style={{ height: height === "auto" ? undefined : height }}
          className={cn(
            "flex min-h-0 w-full max-w-none flex-col rounded-t-[26px] shadow-panel",
            "transition-transform duration-[400ms] ease-sheet sm:max-w-[430px]",
            surface === "popup" ? "bg-surface-popup" : "bg-surface-elevated",
            open ? "translate-y-0" : "translate-y-full",
          )}
        >
          {header}
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-[22px] pb-6">
            {children}
          </div>
          {footer ? <div className="shrink-0">{footer}</div> : null}
        </div>
      </div>
    </OverlayPortal>
  );
}

export function SheetTitle({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-[22px] pb-1 pt-5">
      <h3 className="text-[18px] font-extrabold tracking-[-0.02em]">{title}</h3>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="grid h-8 w-8 place-items-center rounded-full bg-[var(--overlay-wash)] text-muted transition-colors hover:bg-[var(--overlay-wash-hover)]"
      >
        <CloseIcon className="h-[15px] w-[15px]" />
      </button>
    </div>
  );
}

export function SheetFooter({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "grid gap-2.5 bg-surface-popup px-[22px] pt-3.5 shadow-[0_-10px_28px_-14px_var(--shadow-color)]",
        "pb-[calc(18px+env(safe-area-inset-bottom))]",
        columns === 2 ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {children}
    </div>
  );
}
