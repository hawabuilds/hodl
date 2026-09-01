"use client";

import {useEffect, useRef} from "react";
import {cn} from "@/lib/cn";
import {SECTORS, type SectorId} from "@/lib/sectors";

interface SectorRailProps {
  /** Match count per sector within the currently searched set. */
  counts: Map<SectorId, number>;
  total: number;
  value: SectorId | null;
  onChange: (value: SectorId | null) => void;
}

/**
 * Single-select sector filter for the RWA side of the feed.
 *
 * Counts come from the search-filtered set rather than the whole universe, so a
 * chip never promises matches the active query has already excluded. Empty
 * sectors stay in place, dimmed and unclickable — removing them would make the
 * rail reflow under a thumb on every keystroke.
 */
export function SectorRail({counts, total, value, onChange}: SectorRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  // A sector chosen from far down the rail must stay visible after the list
  // re-renders, otherwise the only cue for what is filtered scrolls offscreen.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (!value) {
      rail.scrollTo({left: 0, behavior: "smooth"});
      return;
    }
    rail
      .querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({behavior: "smooth", block: "nearest", inline: "center"});
  }, [value]);

  return (
    <div
      ref={railRef}
      role="group"
      aria-label="Filter by sector"
      className="rail -mx-[22px] mb-3.5 flex gap-[7px] overflow-x-auto overscroll-x-contain px-[22px] pb-0.5"
    >
      <Chip
        label="All"
        count={total}
        active={value === null}
        onClick={() => onChange(null)}
      />
      {SECTORS.map((sector) => {
        const count = counts.get(sector.id) ?? 0;
        const active = value === sector.id;
        return (
          <Chip
            key={sector.id}
            label={sector.label}
            title={sector.description}
            count={count}
            active={active}
            disabled={count === 0 && !active}
            onClick={() => onChange(active ? null : sector.id)}
          />
        );
      })}
    </div>
  );
}

function Chip({
  label,
  title,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title?: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-pill border px-3.5 py-2 text-[12.5px] font-bold leading-none",
        "transition-[background-color,border-color,color,opacity] duration-150",
        active
          ? "border-btn-dark bg-btn-dark text-btn-dark-fg"
          : "border-hairline bg-card text-ink hover:border-[var(--border-hover-strong)]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {label}
      <span
        className={cn(
          "tnum text-[11.5px] font-semibold",
          active ? "text-btn-dark-fg opacity-60" : "text-faint",
        )}
      >
        {count}
      </span>
    </button>
  );
}
