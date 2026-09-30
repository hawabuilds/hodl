"use client";

import {useMemo, useState} from "react";

import {cn} from "@/lib/cn";
import {compactMoney} from "@/lib/format";
import {
  OTHER_KEY,
  REBALANCE_THRESHOLD_PCT,
  actualWeights,
  groupSmallSlices,
  type DriftSlice,
  type GroupedSlice,
} from "@/lib/allocation";
import type {Holding} from "@/lib/types";

/**
 * The portfolio as a donut, with a legend that reads "actual / target" once
 * targets are set. Slices under 2% fold into "Other". Ported from Trador's
 * AllocationChart; the geometry is the same, the styling is HODL's.
 */

export const SLICE_COLORS = [
  "var(--brand-500)",
  "#6B9FE8",
  "#E07A7A",
  "#6BCB94",
  "#E8B86D",
  "#A78BFA",
  "#67C9C3",
  "#F08BBE",
] as const;

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad)};
}

function donutArc(cx: number, cy: number, outer: number, inner: number, startDeg: number, endDeg: number): string {
  if (endDeg - startDeg >= 359.99) endDeg = startDeg + 359.99;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const startOuter = polar(cx, cy, outer, startDeg);
  const endOuter = polar(cx, cy, outer, endDeg);
  const startInner = polar(cx, cy, inner, endDeg);
  const endInner = polar(cx, cy, inner, startDeg);
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

/** A slice's target: its own, or the sum of what it groups. */
function targetOf(slice: GroupedSlice, targets: Record<string, number>): number | undefined {
  if (slice.key !== OTHER_KEY) return targets[slice.key];
  const parts = (slice.grouped ?? []).map((part) => targets[part.key]).filter((v): v is number => v != null);
  return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) : undefined;
}

export function AllocationChart({
  holdings,
  targets,
  targetsActive,
  driftRows,
  donutHeight = 176,
  className,
}: {
  holdings: readonly Holding[];
  targets: Record<string, number>;
  /** Saved targets that add up to 100%: the legend then reads actual / target. */
  targetsActive: boolean;
  driftRows: readonly DriftSlice[];
  donutHeight?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const slices = useMemo(() => groupSmallSlices(actualWeights(holdings)), [holdings]);
  const driftByKey = useMemo(() => new Map(driftRows.map((row) => [row.key, row])), [driftRows]);

  const geometry = useMemo(() => {
    if (slices.length === 0) return null;
    let cursor = 0;
    return slices.map((slice, index) => {
      const start = cursor;
      const end = cursor + (slice.weight / 100) * 360;
      cursor = end;
      return {slice, index, path: donutArc(100, 100, 88, 58, start, end)};
    });
  }, [slices]);

  if (!geometry) {
    return (
      <div className={cn("grid place-items-center px-6 text-center", className)} style={{height: donutHeight}}>
        <p className="max-w-[30ch] text-[12.5px] leading-[1.5] text-faint">
          Your allocation shows here once you hold something with a live price.
        </p>
      </div>
    );
  }

  const focus = active != null ? geometry[active]?.slice : slices[0];
  const summary = `Portfolio allocation: ${slices
    .slice(0, 3)
    .map((slice) => `${slice.symbol} ${slice.weight.toFixed(1)}%`)
    .join(", ")}`;

  return (
    <div className={className}>
      <div style={{height: donutHeight}}>
        <svg viewBox="0 0 200 200" role="img" aria-label={summary} className="mx-auto block h-full w-full max-w-[220px]">
          {geometry.map(({slice, index, path}) => (
            <path
              key={slice.key}
              d={path}
              fill={SLICE_COLORS[index % SLICE_COLORS.length]}
              opacity={active == null || active === index ? 1 : 0.35}
              className="cursor-pointer transition-opacity duration-150"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(index)}
            >
              <title>
                {slice.symbol} · {slice.weight.toFixed(1)}%
              </title>
            </path>
          ))}
          {focus ? (
            <>
              <text x={100} y={96} textAnchor="middle" className="fill-ink font-extrabold" style={{fontSize: 14}}>
                {focus.symbol}
              </text>
              <text x={100} y={116} textAnchor="middle" className="fill-muted font-bold" style={{fontSize: 12}}>
                {focus.weight.toFixed(1)}%
              </text>
            </>
          ) : null}
        </svg>
      </div>

      <ul className="mt-3 space-y-0.5" aria-label="Allocation by holding">
        {geometry.map(({slice, index}) => {
          const target = targetsActive ? targetOf(slice, targets) : undefined;
          const delta =
            slice.key === OTHER_KEY
              ? target != null
                ? slice.weight - target
                : undefined
              : driftByKey.get(slice.key)?.deltaPct;
          const off = targetsActive && delta != null && Math.abs(delta) >= REBALANCE_THRESHOLD_PCT;
          return (
            <li
              key={slice.key}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors",
                active === index && "bg-[var(--overlay-wash)]",
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: SLICE_COLORS[index % SLICE_COLORS.length]}} />
              <span className="min-w-0 flex-1 truncate font-extrabold text-ink">
                {slice.symbol}
                {slice.grouped ? <span className="font-semibold text-faint"> · {slice.grouped.length}</span> : null}
              </span>
              <span className="tabular-nums shrink-0 font-extrabold text-muted">
                {slice.weight.toFixed(1)}%
                {target != null ? (
                  <>
                    <span className="mx-0.5 font-bold text-faint">/</span>
                    {target.toFixed(1)}%
                  </>
                ) : null}
              </span>
              {targetsActive ? (
                <span
                  className={cn(
                    "tabular-nums w-[46px] shrink-0 text-right text-[11.5px] font-bold",
                    off ? "text-warning" : "text-faint",
                  )}
                  title={delta != null ? `${delta >= 0 ? "Over" : "Under"} target by ${Math.abs(delta).toFixed(1)} points` : undefined}
                >
                  {delta == null ? "" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`}
                </span>
              ) : null}
              <span className="tabular-nums w-[52px] shrink-0 text-right text-[11.5px] font-semibold text-faint">
                {compactMoney(slice.valueUsd)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
