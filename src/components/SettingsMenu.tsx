"use client";

import {useEffect, useRef, useState} from "react";
import {useTheme} from "@/hooks/useTheme";
import {cn} from "@/lib/cn";
import type {ThemePreference} from "@/lib/theme";
import {SettingsIcon} from "./ui/Icons";
import {WalletControls} from "./WalletControls";
import {NotificationSettings} from "./NotificationSettings";

const THEME_OPTIONS: {value: ThemePreference; label: string}[] = [
  {value: "system", label: "System"},
  {value: "light", label: "Light"},
  {value: "dark", label: "Dark"},
];

/**
 * Account settings, anchored to the gear that opens them.
 *
 * A panel that grows out of its own control keeps the connection between the
 * two, where a sheet rising from the opposite edge of the screen breaks it.
 */
export function SettingsMenu() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const {preference, setPreference} = useTheme();

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
        data-surface="popup"
        className={cn(
          "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(286px,calc(100vw-44px))]",
          "rounded-2xl bg-surface-popup p-2 shadow-panel",
          "origin-top-right transition-[opacity,transform,visibility] duration-150",
          open
            ? "visible scale-100 opacity-100"
            : "invisible pointer-events-none scale-[0.96] opacity-0",
        )}
      >
        <WalletControls onNavigate={() => setOpen(false)} />

        <div className="mt-1 px-2.5 py-1.5">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            Appearance
          </p>
          <div
            role="group"
            aria-label="Theme"
            className="grid grid-cols-3 gap-1 rounded-2xl bg-[var(--segment-track)] p-1 shadow-inset-soft"
          >
            {THEME_OPTIONS.map((option) => {
              const active = preference === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setPreference(option.value)}
                  className={cn(
                    "rounded-xl px-2 py-1.5 text-[12px] font-bold transition-[background-color,color,box-shadow]",
                    active
                      ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                      : "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            setNotifyOpen(true);
          }}
          className="mt-0.5 flex w-full items-center rounded-[12px] px-2.5 py-2 text-left text-[13.5px] font-bold text-ink hover:bg-[var(--overlay-wash)]"
        >
          Notifications
        </button>
        <p className="mt-1 px-2.5 pb-1.5 text-[10px] font-medium leading-snug text-faint">
          Charts by{" "}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-link underline decoration-[var(--overlay-wash-hover)] underline-offset-2 hover:text-accent"
          >
            Lightweight Charts
          </a>
        </p>
      </div>
      <NotificationSettings open={notifyOpen} onClose={() => setNotifyOpen(false)} />
    </div>
  );
}
