"use client";

import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {cn} from "@/lib/cn";
import {compactMoney, price as fmtPrice, relativeTime, shortAddress, units} from "@/lib/format";
import type {Trade} from "@/lib/types";

/**
 * Recent fills.
 *
 * Side is carried by colour and by the word, not colour alone — the buy/sell
 * distinction is the whole content of the row, so it cannot rest on hue.
 */
export function TradesPanel({
  trades,
  symbol,
  isLoading,
}: {
  trades: Trade[];
  symbol: string;
  isLoading: boolean;
}) {
  if (isLoading && trades.length === 0) {
    return <PanelNote>Loading trades</PanelNote>;
  }
  if (trades.length === 0) {
    return <PanelNote>No trades in this pool yet.</PanelNote>;
  }

  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 border-b border-hairline px-1 pb-2 text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
        <span>Side</span>
        <span>{symbol}</span>
        <span className="text-right">Value</span>
        <span className="text-right">Maker</span>
      </div>
      <ul>
        {trades.map((trade) => {
          const buy = trade.side === "buy";
          return (
            <li
              key={trade.id}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-b border-hairline px-1 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  "w-[34px] rounded-[6px] px-1.5 py-1 text-center text-[10.5px] font-extrabold uppercase",
                  buy
                    ? "bg-[rgba(0,200,5,0.12)] text-green-deep"
                    : "bg-[rgba(255,90,82,0.11)] text-red",
                )}
              >
                {buy ? "Buy" : "Sell"}
              </span>

              <span className="min-w-0">
                <span className="tnum block truncate text-[13px] font-bold tracking-[-0.01em]">
                  {units(trade.amount)}
                </span>
                <span className="tnum block text-[11.5px] font-semibold text-faint">
                  at {fmtPrice(trade.priceUsd)}
                </span>
              </span>

              <span className="text-right">
                <span className="tnum block text-[13px] font-extrabold">
                  {compactMoney(trade.amountUsd)}
                </span>
                <span className="block text-[11.5px] font-semibold text-faint">
                  {relativeTime(trade.at)}
                </span>
              </span>

              <a
                href={addressUrlForChain(trade.maker, RH_MAINNET_ID)}
                target="_blank"
                rel="noopener noreferrer"
                className="tnum text-right text-[11.5px] font-semibold text-faint transition-colors hover:text-ink"
              >
                {shortAddress(trade.maker, 4)}
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
