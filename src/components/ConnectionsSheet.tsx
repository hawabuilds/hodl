"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {compact} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import type {Profile} from "@/lib/types";
import {cn} from "@/lib/cn";
import {Avatar} from "./ui/Avatar";
import {CloseIcon} from "./ui/Icons";
import {OVERLAY_ROOT_ID, OverlayPortal} from "./ui/OverlayPortal";

/**
 * Followers and following, for anyone's profile.
 *
 * Anchored to whichever stat was tapped — a panel beside the trigger, not a
 * sheet from the bottom — so the list reads as belonging to that count.
 */
export function ConnectionsSheet({
  open,
  anchorRef,
  title,
  people,
  loading,
  emptyLabel,
  onClose,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  people: Profile[];
  loading?: boolean;
  emptyLabel: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{top: number; left: number; width: number} | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      if (!anchorRef.current) return;
      const anchor = anchorRef.current.getBoundingClientRect();
      const host = document.getElementById(OVERLAY_ROOT_ID);
      const hostRect = host?.getBoundingClientRect() ?? {top: 0, left: 0, width: window.innerWidth};
      const width = Math.min(320, hostRect.width - 24);
      const maxLeft = hostRect.width - width - 12;
      const left = Math.max(12, Math.min(anchor.left - hostRect.left, maxLeft));
      setPos({
        top: anchor.bottom - hostRect.top + 8,
        left,
        width,
      });
    };
    place();
    // Positioned in coordinates measured once. A phone never resizes under an
    // open popover; a desktop window does, and without this the list stayed
    // where the old layout put it while its anchor moved away.
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchorRef, people.length, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <OverlayPortal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        data-surface="popup"
        style={
          pos
            ? {position: "absolute", top: pos.top, left: pos.left, width: pos.width}
            : undefined
        }
        className={cn(
          "z-[55] max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-surface-popup shadow-panel",
          "origin-top transition-[opacity,transform,visibility] duration-150",
          // The overlay root is pointer-events:none so the frame stays clickable
          // through it; every panel portaled in has to take events back or it
          // renders perfectly and ignores every click, this one included.
          pos
            ? "visible pointer-events-auto scale-100 opacity-100"
            : "invisible pointer-events-none opacity-0",
        )}
      >
        <div className="sticky top-0 z-[1] flex items-center justify-between bg-surface-popup px-4 pb-1 pt-3">
          <h3 className="text-[15px] font-extrabold tracking-[-0.02em]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full bg-[var(--overlay-wash)] text-muted transition-colors hover:bg-[var(--overlay-wash-hover)]"
          >
            <CloseIcon className="h-[13px] w-[13px]" />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-[13px] text-muted">Loading</p>
        ) : people.length === 0 ? (
          <p className="mx-auto max-w-[30ch] px-4 py-8 text-center text-[13px] leading-[1.5] text-muted">
            {emptyLabel}
          </p>
        ) : (
          <ul className="pb-2 pt-1">
            {people.map((person) => (
              <li key={person.handle}>
                <Link
                  href={profilePath(person.handle)}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--overlay-wash)]"
                >
                  <Avatar name={person.displayName} src={person.pfpUrl} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-extrabold tracking-[-0.015em]">
                      {person.displayName}
                    </div>
                    <div className="truncate text-[12px] font-semibold text-faint">
                      @{person.handle} {compact(person.followers)} followers
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </OverlayPortal>
  );
}
