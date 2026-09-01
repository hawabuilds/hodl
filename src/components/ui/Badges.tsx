import {cn} from "@/lib/cn";
import type {StockType} from "@/lib/types";
import {VerifiedIcon} from "./Icons";

const STOCK_TYPE_LABEL: Record<StockType, string> = {
  stock: "Stock",
  etf: "ETF",
  adr: "ADR",
  fund: "Fund",
};

/**
 * The only badge that carries a claim: it means Robinhood issued this token
 * against the underlying asset. Nothing on the token side is ever given one.
 */
export function VerifiedBadge({
  label = "Official RWA",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      title="Official Robinhood tokenized asset"
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border border-[rgba(0,200,5,0.28)] bg-[rgba(0,200,5,0.1)] px-2 py-[3px]",
        "text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-green-deep",
        className,
      )}
    >
      <VerifiedIcon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function TypeBadge({
  type,
  className,
}: {
  type: StockType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border border-hairline bg-wash px-2 py-[3px]",
        "text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-muted",
        className,
      )}
    >
      {STOCK_TYPE_LABEL[type]}
    </span>
  );
}

/** Marks a token by the RWA sitting on the other side of its pool. */
export function PairBadge({
  ticker,
  className,
}: {
  ticker: string;
  className?: string;
}) {
  return (
    <span
      title={`Liquidity paired against ${ticker}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border border-hairline bg-wash px-2 py-[3px]",
        "text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-muted",
        className,
      )}
    >
      <span className="text-faint">LP</span>
      {ticker}
    </span>
  );
}
