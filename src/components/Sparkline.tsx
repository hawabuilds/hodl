import {useId} from "react";
import {cn} from "@/lib/cn";

interface SparklineProps {
  series: number[];
  positive: boolean;
  className?: string;
  height?: number;
}

const WIDTH = 100;
const PAD = 3;

/**
 * A row's mini chart: a 1.5px line, green or red by the move over the period
 * shown, a soft fade underneath, and a dot on the latest price. No grid, no
 * reference lines. A level series (no trades yet) draws flat at mid-height.
 * The chart page draws its own, full chart.
 */
export function Sparkline({series, positive, className, height = 30}: SparklineProps) {
  const fadeId = useId().replace(/:/g, "");
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const flat = max === min;
  const y = (value: number) =>
    flat ? height / 2 : PAD + (1 - (value - min) / (max - min)) * (height - PAD * 2);
  const points = series.map((value, i) => [(i / (series.length - 1)) * WIDTH, y(value)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
  const area = `${line} L${WIDTH},${height} L0,${height} Z`;
  const colour = positive ? "var(--price-up)" : "var(--price-down)";
  const last = points[points.length - 1];

  return (
    <span className={cn("relative block", className)} aria-hidden="true">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" fill="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity="0.22" />
            <stop offset="100%" stopColor={colour} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${fadeId})`} />
        <path
          d={line}
          stroke={colour}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Drawn outside the stretched SVG so it stays round at any width. */}
      <span
        className="absolute h-[5px] w-[5px] -translate-y-1/2 translate-x-1/2 rounded-full"
        style={{right: 0, top: `${(last[1] / height) * 100}%`, background: colour}}
      />
    </span>
  );
}
