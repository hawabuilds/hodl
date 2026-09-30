"use client";

import {useEffect, useRef, useState, type ReactNode} from "react";
import {useIsDesktop} from "@/hooks/useBreakpoint";
import {useMe} from "@/hooks/useMe";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {SettingsIcon} from "./ui/Icons";
import {WalletControls} from "./WalletControls";
import {NotificationSettings} from "./NotificationSettings";
import {AlertSettings} from "./AlertSettings";

interface TriggerProps {
  open: boolean;
  toggle: () => void;
}

/**
 * Account settings, anchored to the gear that opens them.
 *
 * A panel that grows out of its own control keeps the connection between the
 * two, where a sheet rising from the opposite edge of the screen breaks it.
 *
 * `trigger` swaps the gear for another control: the desktop top bar opens the
 * same menu from its account pill.
 */
export function SettingsMenu({
  trigger,
}: {
  trigger?: (props: TriggerProps) => ReactNode;
} = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const desktop = useIsDesktop();
  const user = useUser();
  const me = useMe();

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
      {trigger ? (
        trigger({open, toggle: () => setOpen((prev) => !prev)})
      ) : (
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
      )}

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

        {user.authenticated ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => me.savePortfolioPublic(!me.portfolioPublic)}
            className="mt-0.5 flex w-full items-center justify-between rounded-[12px] px-2.5 py-2 text-left hover:bg-[var(--overlay-wash)]"
          >
            <span className="text-[13.5px] font-bold text-ink">Show portfolio publicly</span>
            <span
              className={cn(
                "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                me.portfolioPublic ? "bg-success" : "bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                  me.portfolioPublic ? "left-[18px]" : "left-0.5",
                )}
              />
            </span>
          </button>
        ) : null}

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
        {/* The Following tab, the bell and pop-ups are desktop-only for now. */}
        {desktop && user.authenticated ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setAlertsOpen(true);
            }}
            className="mt-0.5 flex w-full items-center rounded-[12px] px-2.5 py-2 text-left text-[13.5px] font-bold text-ink hover:bg-[var(--overlay-wash)]"
          >
            Alerts
          </button>
        ) : null}
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
      {desktop ? <AlertSettings open={alertsOpen} onClose={() => setAlertsOpen(false)} /> : null}
    </div>
  );
}
