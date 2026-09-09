"use client";

import {cn} from "@/lib/cn";
import {useWatchlist} from "@/hooks/useWatchlist";
import type {AssetKind} from "@/lib/types";
import {StarFilledIcon, StarIcon} from "./ui/Icons";

/** Watchlist toggle. Sits next to the name on a chart page. */
export function WatchStar({
  kind,
  id,
  className,
  size = 18,
  addPrice = null,
}: {
  kind: AssetKind;
  id: string;
  className?: string;
  size?: number;
  addPrice?: number | null;
}) {
  const {has, toggle} = useWatchlist();
  const watched = has(kind, id);
  const Icon = watched ? StarFilledIcon : StarIcon;

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(kind, id, addPrice);
      }}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
        watched
          ? "text-price-up hover:bg-[rgb(61_219_168/10%)]"
          : "text-faint hover:bg-[var(--overlay-wash)] hover:text-ink",
        className,
      )}
    >
      <Icon style={{width: size, height: size}} />
    </button>
  );
}
