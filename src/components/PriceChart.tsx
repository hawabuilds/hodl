"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {cn} from "@/lib/cn";
import {
  gapBreakMsForWindow,
  plotRange,
  pointsInRange,
  splitOnGaps,
  xAt,
} from "@/lib/chartPlot";
import type {ChartPoint} from "@/lib/types";

interface PriceChartProps {
  points: ChartPoint[];
  height?: number;
  /** Overrides the up / down colour, e.g. for a portfolio line. */
  positive?: boolean;
  /** Dashed rule at the window open, the way a brokerage marks previous close. */
  showBaseline?: boolean;
  /**
   * When set, the x-axis is this many milliseconds ending at now. The last
   * real print is not stretched to the right edge.
   */
  windowMs?: number;
  emptyLabel?: string;
  className?: string;
  /**
   * Fires as a finger or cursor moves across the chart, and with null when it
   * leaves. The header price follows this so the number under the scrubber is
   * the one being read, not the live one.
   */
  onScrub?: (point: ChartPoint | null) => void;
}

const PAD_Y = 10;

function linePath(
  segment: ChartPoint[],
  x: (t: number) => number,
  y: (price: number) => number,
): string {
  return segment
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${x(point.t).toFixed(2)},${y(point.price).toFixed(2)}`,
    )
    .join(" ");
}

/**
 * The price chart.
 *
 * Laid out in real pixels rather than a stretched viewBox: a non-uniform
 * viewBox is simpler, but it squashes the scrubber dot into an ellipse and
 * makes the crosshair drift away from the finger. A ResizeObserver keeps the
 * width honest inside the phone frame and on a resized desktop window.
 *
 * X is time, not index. A young series is a short line. On 1h and coarser,
 * a silent stretch is a gap. On 1m/5m the line connects real prints.
 * Nothing is drawn past the last real print.
 */
export function PriceChart({
  points,
  height = 190,
  positive,
  showBaseline = true,
  windowMs,
  emptyLabel = "Not enough history yet",
  className,
  onScrub,
}: PriceChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(host);
    setWidth(host.clientWidth);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const {start, end} = plotRange(points, windowMs);
    const visible = pointsInRange(points, start, end);
    if (visible.length < 2 || width <= 0) return null;

    const prices = visible.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || Math.max(max * 0.001, 1e-9);

    const x = (t: number) => xAt(t, start, end, width);
    const y = (price: number) =>
      PAD_Y + (1 - (price - min) / span) * (height - PAD_Y * 2);

    const segments = splitOnGaps(visible, gapBreakMsForWindow(windowMs));
    const drawable = segments.filter((segment) => segment.length >= 2);
    if (drawable.length === 0) return null;

    const last = visible[visible.length - 1];
    const first = visible[0];

    return {
      segments: drawable.map((segment) => linePath(segment, x, y)),
      areas: drawable.map((segment) => {
        const line = linePath(segment, x, y);
        const x0 = x(segment[0].t);
        const x1 = x(segment[segment.length - 1].t);
        return `${line} L${x1.toFixed(2)},${height} L${x0.toFixed(2)},${height} Z`;
      }),
      x,
      y,
      visible,
      first: first.price,
      last: last.price,
      lastT: last.t,
    };
  }, [points, width, height, windowMs]);

  const up =
    positive ?? (geometry ? geometry.last >= geometry.first : true);
  const color = up ? "var(--green)" : "var(--red)";

  const report = useCallback(
    (index: number | null) => {
      setActiveIndex(index);
      onScrub?.(
        index === null || !geometry ? null : geometry.visible[index],
      );
    },
    [onScrub, geometry],
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!geometry || width <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      const {start, end} = plotRange(points, windowMs);
      const t = start + ratio * (end - start);
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < geometry.visible.length; i++) {
        const dist = Math.abs(geometry.visible[i].t - t);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      report(best);
    },
    [geometry, points, report, width, windowMs],
  );

  const gradientId = useMemo(
    () => `chart-fill-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  return (
    <div
      ref={hostRef}
      style={{height}}
      className={cn("relative w-full touch-pan-y select-none", className)}
      // Pointer events rather than mouse + touch: this has to work under a
      // finger on the phone layout and under a cursor on desktop, and pointer
      // capture keeps the scrub alive when the finger leaves the box.
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.pressure > 0 || e.pointerType === "mouse") move(e);
      }}
      onPointerUp={() => report(null)}
      onPointerCancel={() => report(null)}
      onPointerLeave={() => report(null)}
    >
      {geometry ? (
        <svg
          width={width}
          height={height}
          aria-hidden="true"
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.2" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {geometry.areas.map((area, i) => (
            <path key={`area-${i}`} d={area} fill={`url(#${gradientId})`} />
          ))}

          {showBaseline ? (
            <line
              x1="0"
              x2={width}
              y1={geometry.y(geometry.first)}
              y2={geometry.y(geometry.first)}
              stroke="var(--faint)"
              strokeWidth="1"
              strokeDasharray="3 4"
              opacity="0.7"
            />
          ) : null}

          {geometry.segments.map((line, i) => (
            <path
              key={`line-${i}`}
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {activeIndex !== null ? (
            <g>
              <line
                x1={geometry.x(geometry.visible[activeIndex].t)}
                x2={geometry.x(geometry.visible[activeIndex].t)}
                y1={0}
                y2={height}
                stroke="var(--hairline)"
                strokeWidth="1"
              />
              <circle
                cx={geometry.x(geometry.visible[activeIndex].t)}
                cy={geometry.y(geometry.visible[activeIndex].price)}
                r="4.5"
                fill={color}
                stroke="var(--card)"
                strokeWidth="2.5"
              />
            </g>
          ) : (
            <circle
              cx={geometry.x(geometry.lastT)}
              cy={geometry.y(geometry.last)}
              r="3.5"
              fill={color}
              className="transition-[cx,cy] duration-300 ease-out"
            />
          )}
        </svg>
      ) : (
        <div className="grid h-full place-items-center rounded-panel bg-wash text-[13px] font-medium text-faint">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
