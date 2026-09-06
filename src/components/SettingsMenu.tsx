"use client";

import {useEffect, useRef, useState} from "react";
import {cn} from "@/lib/cn";
import {SettingsIcon} from "./ui/Icons";
import {WalletControls} from "./WalletControls";

/**
 * Account settings, anchored to the gear that opens them.
 *
 * A panel that grows out of its own control keeps the connection between the
 * two, where a sheet rising from the opposite edge of the screen breaks it.
 */
export function SettingsMenu() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings"
        className={cn(
          "-mr-1 grid h-9 w-9 place-items-center rounded-full transition-colors",
          open
            ? "bg-[var(--overlay-wash-hover)] text-ink"
            : "text-muted hover:bg-[var(--overlay-wash)] hover:text-ink",
        )}
      >
        <SettingsIcon className="h-[19px] w-[19px]" />
      </button>

      <div
        role="menu"
        aria-label="Settings"
        className={cn(
          "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(286px,calc(100vw-44px))]",
          "rounded-panel border border-hairline bg-card p-2 shadow-menu",
          "origin-top-right transition-[opacity,transform,visibility] duration-150",
          open
            ? "visible scale-100 opacity-100"
            : "invisible pointer-events-none scale-[0.96] opacity-0",
        )}
      >
        <WalletControls onNavigate={() => setOpen(false)} />
        <p className="mt-1 px-2.5 pb-1.5 text-[10px] font-medium leading-snug text-faint">
          Charts by{" "}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-hairline underline-offset-2 hover:text-muted"
          >
            Lightweight Charts
          </a>
        </p>
      </div>
    </div>
  );
}
