"use client";

import {AssetLink} from "@/components/AssetLink";
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
 * The mark on an official Robinhood tokenized asset.
 *
 * Icon only, no label: it sits directly beside the ticker in a dense list, and
 * a word there would compete with the one piece of text the row is actually
 * scanned for. The title and screen-reader text carry the meaning.
 */
export function VerifiedTick({
  size = 15,
  label = "Verified real-world asset",
  className,
}: {
  size?: number;
  /** What the tick is vouching for. Assets by default, accounts on the feed. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      title={label}
      className={cn("inline-flex shrink-0 text-brand-400", className)}
    >
      <VerifiedIcon style={{width: size, height: size}} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The RWA a token's pool is paired against, as it appears in a list row.
 *
 * Just the ticker. In context — sitting immediately after the token symbol —
 * the pairing reads without a label, and the chart page spells it out in full.
 */
export function PairTicker({
  ticker,
  className,
}: {
  ticker: string;
  className?: string;
}) {
  return (
    <span
      title={`Paired against ${ticker}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px]",
        "text-[10.5px] font-extrabold uppercase leading-none tracking-[0.03em] text-muted",
        className,
      )}
    >
      {ticker}
    </span>
  );
}

/**
 * The pairing on a chart page, written the way a market is written anywhere
 * else in crypto. The quote side links to its own page.
 */
export function PairMarket({
  base,
  quote,
  className,
}: {
  base: string;
  quote: string;
  className?: string;
}) {
  return (
    <AssetLink
      kind="rwa"
      id={quote}
      title={`${base} is paired against ${quote}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1",
        "text-[11.5px] font-extrabold leading-none tracking-[-0.01em]",
        "transition-colors hover:bg-[var(--overlay-wash-hover)]",
        className,
      )}
    >
      <span className="text-muted">{base}</span>
      <span className="text-faint">/</span>
      <span className="text-ink">{quote}</span>
      <VerifiedIcon className="h-3 w-3 text-brand-400" />
    </AssetLink>
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
        "inline-flex items-center rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px]",
        "text-[10.5px] font-extrabold uppercase leading-none tracking-[0.03em] text-muted",
        className,
      )}
    >
      {STOCK_TYPE_LABEL[type]}
    </span>
  );
}

/**
 * What a trade costs beyond the price: the pool's swap fee plus any
 * fee-on-transfer the token charges.
 *
 * Three states, not two. "None" is a measurement that came back zero;
 * "Unknown" is a measurement that could not be made. The chip used to collapse
 * those together and told every visitor "No transfer tax" about tokens nothing
 * had ever checked, which is the one thing it must not do.
 */
export function TaxChip({
  buyPct,
  sellPct,
  className,
}: {
  buyPct: number | null;
  sellPct: number | null;
  className?: string;
}) {
  const unmeasured = buyPct === null && sellPct === null;
  const free = buyPct === 0 && sellPct === 0;

  const label = unmeasured
    ? "Unknown"
    : free
      ? "None"
      : `${fmtPct(buyPct)} / ${fmtPct(sellPct)}`;

  const title = unmeasured
    ? "Trading cost could not be measured for this token"
    : free
      ? "No swap fee and no transfer tax"
      : `Buy costs ${fmtPct(buyPct)}, sell costs ${fmtPct(sellPct)} — pool fee plus any transfer tax`;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1",
        "text-[11.5px] font-extrabold leading-none",
        free
          ? "bg-[rgb(61_219_168/11%)] text-price-up"
          : "bg-[var(--overlay-wash)] text-ink",
        className,
      )}
    >
      <span className={free ? "text-price-up opacity-70" : "text-faint"}>
        Tax
      </span>
      {label}
    </span>
  );
}

/** A percent, or an em dash where there is no measurement to show. */
export function fmtPct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}
