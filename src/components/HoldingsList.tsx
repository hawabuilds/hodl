"use client";

import Link from "next/link";
import {cn} from "@/lib/cn";
import {money, percent, units} from "@/lib/format";
import {assetPath} from "@/lib/routes";
import type {Holding} from "@/lib/types";
import {Avatar} from "./ui/Avatar";

export interface HoldingsListProps {
  holdings: Holding[];
  /** Unrealised P&L per row, keyed by asset id. Own book only. */
  pnl?: Map<string, {pnlUsd: number; pnlPct: number}>;
  empty: string;
}

/**
 * Holdings, as rows that link through to the chart page.
 *
 * The secondary line carries P&L when the viewer owns the book and the 24-hour
 * move otherwise — showing someone else's P&L would mean inventing a cost
 * basis nobody published.
 */
export function HoldingsList({holdings, pnl, empty}: HoldingsListProps) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-[16px] border border-hairline bg-card px-4 py-6 text-center text-[13px] leading-[1.5] text-muted">
        {empty}
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-[16px] border border-hairline bg-card">
      {holdings.map((holding) => {
        const row = pnl?.get(holding.assetId);
        const secondaryValue = row ? row.pnlPct : holding.changePct;
        const positive = secondaryValue >= 0;

        return (
          <li key={`${holding.kind}:${holding.assetId}`} className="border-b border-hairline last:border-b-0">
            <Link
              href={assetPath(holding.kind, holding.assetId)}
              className="flex items-center gap-3 px-4 py-[13px] transition-colors hover:bg-wash"
            >
              <Avatar name={holding.symbol} src={holding.logoUrl} size={36} />

              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-extrabold tracking-[-0.01em]">
                  {holding.symbol}
                </div>
                <div className="tnum truncate text-[12px] font-semibold text-faint">
                  {units(holding.amount)} {holding.kind === "rwa" ? "shares" : "tokens"}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="tnum text-[13.5px] font-extrabold tracking-[-0.01em]">
                  {money(holding.valueUsd)}
                </div>
                <div
                  className={cn(
                    "tnum text-[12px] font-bold",
                    positive ? "text-green-deep" : "text-red",
                  )}
                >
                  {row
                    ? `${row.pnlUsd >= 0 ? "+" : "−"}${money(Math.abs(row.pnlUsd))}`
                    : percent(holding.changePct)}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
