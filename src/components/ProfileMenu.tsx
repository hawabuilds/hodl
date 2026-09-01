"use client";

import {useEffect, useRef, useState} from "react";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {Avatar} from "./ui/Avatar";
import {WalletControls} from "./WalletControls";

/** The avatar in the app header, and the account menu behind it. */
export function ProfileMenu() {
  const {displayName, pfpUrl} = useUser();
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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account and wallet"
        className="block rounded-full"
      >
        <Avatar name={displayName} src={pfpUrl} size={40} ring />
      </button>

      <div
        role="menu"
        aria-label="Account"
        className={cn(
          "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(280px,calc(100vw-44px))]",
          "rounded-panel border border-hairline bg-card p-2 shadow-menu",
          "origin-top-right transition-[opacity,transform,visibility] duration-150",
          open
            ? "visible scale-100 opacity-100"
            : "invisible pointer-events-none scale-[0.98] opacity-0",
        )}
      >
        <WalletControls onNavigate={() => setOpen(false)} />
      </div>
    </div>
  );
}
