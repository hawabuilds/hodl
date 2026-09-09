import {cn} from "@/lib/cn";

interface SparklineProps {
  series: number[];
  positive: boolean;
  className?: string;
  height?: number;
}

const WIDTH = 100;
const PAD = 2;

/** Card-sized line. The chart page draws its own, pixel-accurate one. */
export function Sparkline({
  series,
  positive,
  className,
  height = 30,
}: SparklineProps) {
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;

  const path = series
    .map((value, i) => {
      const x = (i / (series.length - 1)) * WIDTH;
      const y = PAD + (1 - (value - min) / span) * (height - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      className={cn("block", className)}
    >
      <path
        d={path}
        stroke={positive ? "var(--price-up)" : "var(--price-down)"}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
