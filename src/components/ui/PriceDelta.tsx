import {cn} from "@/lib/cn";

/**
 * Price / P&L change with mandatory direction glyph (▲/▼) plus +/- prefix.
 * Color alone is not sufficient for accessibility.
 */
export function PriceDelta({
  value,
  className,
  showSign = true,
}: {
  value: number;
  className?: string;
  /** When false, only the triangle and absolute magnitude (for pre-signed strings). */
  showSign?: boolean;
}) {
  if (!Number.isFinite(value)) {
    return <span className={cn("tabular-nums text-faint", className)}>—</span>;
  }

  const positive = value >= 0;
  const glyph = positive ? "▲" : "▼";
  const sign = showSign ? (positive ? "+" : "") : "";
  const formatted = `${sign}${Math.abs(value).toFixed(2)}%`;

  return (
    <span
      className={cn(
        "tabular-nums inline-flex items-center gap-0.5",
        positive ? "text-price-up" : "text-price-down",
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.85em] leading-none">
        {glyph}
      </span>
      {formatted}
    </span>
  );
}
