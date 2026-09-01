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
import type {ChartPoint} from "@/lib/types";

interface PriceChartProps {
  points: ChartPoint[];
  height?: number;
  /** Overrides the up / down colour, e.g. for a portfolio line. */
  positive?: boolean;
  /** Dashed rule at the window open, the way a brokerage marks previous close. */
  showBaseline?: boolean;
  className?: string;
  /**
   * Fires as a finger or cursor moves across the chart, and with null when it
   * leaves. The header price follows this so the number under the scrubber is
   * the one being read, not the live one.
   */
  onScrub?: (point: ChartPoint | null) => void;
}

const PAD_Y = 10;

/**
 * The price chart.
 *
 * Laid out in real pixels rather than a stretched viewBox: a non-uniform
 * viewBox is simpler, but it squashes the scrubber dot into an ellipse and
 * makes the crosshair drift away from the finger. A ResizeObserver keeps the
 * width honest inside the phone frame and on a resized desktop window.
 */
export function PriceChart({
  points,
  height = 190,
  positive,
  showBaseline = true,
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
    if (points.length < 2 || width <= 0) return null;

    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || Math.max(max * 0.001, 1e-9);

    const x = (i: number) => (i / (points.length - 1)) * width;
    const y = (price: number) =>
      PAD_Y + (1 - (price - min) / span) * (height - PAD_Y * 2);

    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.price).toFixed(2)}`)
      .join(" ");

    return {
      line,
      area: `${line} L${width.toFixed(2)},${height} L0,${height} Z`,
      x,
      y,
      first: points[0].price,
      last: points[points.length - 1].price,
    };
  }, [points, width, height]);

  const up =
    positive ?? (geometry ? geometry.last >= geometry.first : true);
  const color = up ? "var(--green)" : "var(--red)";

  const report = useCallback(
    (index: number | null) => {
      setActiveIndex(index);
      onScrub?.(index === null ? null : points[index]);
    },
    [onScrub, points],
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!geometry || width <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      const index = Math.round(ratio * (points.length - 1));
      report(Math.min(Math.max(index, 0), points.length - 1));
    },
    [geometry, points.length, report, width],
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

          <path d={geometry.area} fill={`url(#${gradientId})`} />

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

          <path
            d={geometry.line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {activeIndex !== null ? (
            <g>
              <line
                x1={geometry.x(activeIndex)}
                x2={geometry.x(activeIndex)}
                y1={0}
                y2={height}
                stroke="var(--hairline)"
                strokeWidth="1"
              />
              <circle
                cx={geometry.x(activeIndex)}
                cy={geometry.y(points[activeIndex].price)}
                r="4.5"
                fill={color}
                stroke="var(--card)"
                strokeWidth="2.5"
              />
            </g>
          ) : (
            <circle
              cx={geometry.x(points.length - 1)}
              cy={geometry.y(geometry.last)}
              r="3.5"
              fill={color}
            />
          )}
        </svg>
      ) : (
        <div className="grid h-full place-items-center rounded-panel bg-wash text-[13px] font-medium text-faint">
          Not enough history yet
        </div>
      )}
    </div>
  );
}
