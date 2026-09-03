"use client";

import Link from "next/link";
import {cn} from "@/lib/cn";
import {money, percent, units} from "@/lib/format";
import {assetPath} from "@/lib/routes";
import type {Holding} from "@/lib/types";
import {Avatar} from "./ui/Avatar";
import {VerifiedTick} from "./ui/Badges";

/**
 * Holdings, as rows that link through to the chart page.
 *
 * The right-hand column is always position value over unrealised profit rather
 * than the asset's own 24-hour move: on a portfolio, what the position has done
 * since it was opened is the number being looked for, and the day's move is
 * already one tap away on the chart page.
 */
export function HoldingsList({
  holdings,
  empty,
}: {
  holdings: Holding[];
  empty: string;
}) {
  if (holdings.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-[13px] leading-[1.5] text-muted">
        {empty}
      </p>
    );
  }

  return (
    <ul className="-mx-[22px]">
      {holdings.map((holding) => {
        // Profit needs a basis. Balances that arrived from anywhere but this
        // platform have none, and treating that as a cost of zero would print
        // the whole position as profit — so those rows show the asset's own
        // move over the day instead, which is a fact about the asset rather
        // than a claim about what the holder paid.
        const basis = holding.costUsd;
        const pnlUsd = basis === null ? null : holding.valueUsd - basis;
        const pnlPct =
          basis !== null && basis > 0 ? ((pnlUsd ?? 0) / basis) * 100 : null;
        const positive = (pnlUsd ?? holding.changePct) >= 0;

        return (
          <li key={`${holding.kind}:${holding.assetId}`}>
            <Link
              href={assetPath(holding.kind, holding.assetId)}
              className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
            >
              {holding.kind === "rwa" ? null : (
                <Avatar name={holding.symbol} src={holding.logoUrl} size={38} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[14px] font-extrabold tracking-[-0.015em]">
                    {holding.symbol}
                  </span>
                  {holding.kind === "rwa" ? <VerifiedTick size={13} /> : null}
                </div>
                <div className="tnum mt-[3px] truncate text-[12px] font-semibold text-faint">
                  {units(holding.amount)}{" "}
                  {holding.kind === "rwa" ? "shares" : "tokens"}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="tnum text-[14px] font-extrabold tracking-[-0.015em]">
                  {money(holding.valueUsd)}
                </div>
                <div
                  className={cn(
                    "tnum mt-[3px] text-[12px] font-bold",
                    positive ? "text-green-deep" : "text-red",
                  )}
                >
                  {pnlUsd === null ? (
                    <>
                      {percent(holding.changePct)}
                      <span className="ml-1.5 font-semibold opacity-75">24h</span>
                    </>
                  ) : (
                    <>
                      {positive ? "+" : "−"}
                      {money(Math.abs(pnlUsd))}
                      {pnlPct === null ? null : (
                        <span className="ml-1.5 font-semibold opacity-75">
                          {percent(pnlPct)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
