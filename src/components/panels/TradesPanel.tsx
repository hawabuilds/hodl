"use client";

import {useArrivals} from "@/hooks/useArrivals";
import {RH_MAINNET_ID, txUrlForChain} from "@/config/chain";
import {cn} from "@/lib/cn";
import {
  compactMoney,
  price as fmtPrice,
  relativeTime,
  shortAddress,
  units,
} from "@/lib/format";
import type {Trade} from "@/lib/types";
import {ArrowUpRightIcon} from "../ui/Icons";

/**
 * The tape.
 *
 * Four columns in the order a fill is read: what happened, how much of the
 * asset moved, what it was worth, and where to verify it. Header and rows share
 * one fixed template — the header lived on its own grid before, so `auto`
 * columns sized to different content and the labels drifted off their numbers.
 *
 * No rules between rows. Direction is already the strongest signal on the line;
 * hairlines on top of it turn a tape into a spreadsheet.
 */
const COLUMNS = "grid grid-cols-[58px_1fr_76px_72px] items-center gap-2";

export function TradesPanel({
  trades,
  symbol,
  isLoading,
  error,
  onRetry,
}: {
  trades: Trade[];
  symbol: string;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const arrivals = useArrivals(trades.map((trade) => trade.id));

  if (isLoading && trades.length === 0) {
    return <PanelNote>Loading trades</PanelNote>;
  }
  if (error && trades.length === 0) {
    return <PanelError message={error} onRetry={onRetry} />;
  }
  if (trades.length === 0) {
    return <PanelNote>No trades yet.</PanelNote>;
  }

  return (
    <div className="-mx-[22px]">
      <div
        className={cn(
          COLUMNS,
          "px-[22px] pb-2 text-[10px] font-bold uppercase tracking-[0.09em] text-faint",
        )}
      >
        <span>Type</span>
        <span>Amount</span>
        <span className="text-right">USD</span>
        <span className="text-right">TXN</span>
      </div>

      <ul>
        {trades.map((trade) => {
          const buy = trade.side === "buy";
          const fresh = arrivals.has(trade.id);
          return (
            <li
              key={trade.id}
              className={cn(
                COLUMNS,
                "px-[22px] py-[9px] transition-colors duration-150 hover:bg-[var(--overlay-wash)]",
                fresh && "trade-in",
              )}
            >
              <div className="min-w-0">
                <span
                  className={cn(
                    "block text-[12.5px] font-extrabold leading-none",
                    buy ? "text-price-up" : "text-price-down",
                  )}
                >
                  {buy ? "Buy" : "Sell"}
                </span>
                <span className="mt-1 block text-[10.5px] font-semibold text-faint">
                  {relativeTime(trade.at)}
                </span>
              </div>

              <div className="min-w-0">
                <span className="tabular-nums block truncate text-[13.5px] font-bold tracking-[-0.01em]">
                  {units(trade.amount)}
                  <span className="ml-1 text-[10.5px] font-semibold text-faint">
                    {symbol}
                  </span>
                </span>
                <span className="tabular-nums mt-1 block truncate text-[10.5px] font-semibold text-faint">
                  {fmtPrice(trade.priceUsd)}
                </span>
              </div>

              <span
                className={cn(
                  "tabular-nums self-center text-right text-[13.5px] font-extrabold tracking-[-0.01em]",
                  buy ? "text-price-up" : "text-price-down",
                )}
              >
                {compactMoney(trade.amountUsd)}
              </span>

              <a
                href={txUrlForChain(trade.txHash, RH_MAINNET_ID)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View transaction"
                // No horizontal padding: the hash has to end on the same pixel
                // as the TXN heading above it, and any inset here pushes it off.
                // The row carries the hover surface instead.
                className={cn(
                  "flex items-center justify-end gap-1 self-center",
                  "font-mono text-[10.5px] text-faint transition-colors hover:text-ink",
                )}
              >
                {shortAddress(trade.txHash, 4)}
                <ArrowUpRightIcon className="h-[11px] w-[11px] shrink-0" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PanelNote({children}: {children: React.ReactNode}) {
  return (
    <p className="grid min-h-[96px] place-items-center px-6 text-center text-[13px] leading-[1.5] text-muted">
      {children}
    </p>
  );
}

export function PanelError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="grid min-h-[96px] place-items-center px-6 text-center">
      <p className="text-[13px] leading-[1.5] text-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[13px] font-bold text-accent-link"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
