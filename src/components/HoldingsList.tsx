"use client";

import Link from "next/link";
import {AssetLink} from "@/components/AssetLink";
import {cn} from "@/lib/cn";
import {money, units} from "@/lib/format";
import {formatLiquidityUsd, formatPriceUsd} from "@/lib/priceState";
import type {Holding} from "@/lib/types";
import {loadedLogoFor} from "@/lib/tokenLogoCache";
import {tokenFor} from "@/lib/tokenCache";
import {TokenAvatar} from "./ui/TokenAvatar";
import {useTokenLaunchpad} from "@/hooks/useTokenLaunchpad";
import {VerifiedTick} from "./ui/Badges";
import {PriceDelta} from "./ui/PriceDelta";

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
        const {pnlUsd, pnlPct, positive} = positionReturn(holding);

        return (
          <li key={`${holding.kind}:${holding.assetId}`}>
            <AssetLink
              kind={holding.kind}
              id={holding.assetId}
              className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
            >
              {holding.kind === "rwa" ? null : (
                <HoldingAvatar holding={holding} size={38} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[14px] font-extrabold tracking-[-0.015em]">
                    {holding.symbol}
                  </span>
                  {holding.kind === "rwa" ? <VerifiedTick size={13} /> : null}
                </div>
                <div className="tabular-nums mt-[3px] truncate text-[12px] font-semibold text-faint">
                  {units(holding.amount)}{" "}
                  {holding.kind === "rwa" ? "shares" : "tokens"}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="tabular-nums text-[14px] font-extrabold tracking-[-0.015em]">
                  {formatLiquidityUsd(holding.valueUsd)}
                </div>
                <div className="tabular-nums mt-[3px] text-[12px] font-bold">
                  {pnlUsd === null ? (
                    <>
                      <PriceDelta value={holding.changePct} />
                      <span className="ml-1.5 font-semibold text-faint opacity-75">
                        24h
                      </span>
                    </>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5",
                        positive ? "text-price-up" : "text-price-down",
                      )}
                    >
                      <span aria-hidden="true" className="text-[0.85em]">
                        {positive ? "▲" : "▼"}
                      </span>
                      {positive ? "+" : "−"}
                      {money(Math.abs(pnlUsd))}
                      {pnlPct === null ? null : (
                        <span className="ml-1.5 font-semibold opacity-75">
                          <PriceDelta value={pnlPct} />
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </AssetLink>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What a position has made, where that can be known.
 *
 * Profit needs a basis. Balances that arrived from anywhere but this platform
 * have none, and treating that as a cost of zero would print the whole
 * position as profit — so those rows show the asset's own move over the day
 * instead, which is a fact about the asset rather than a claim about what the
 * holder paid.
 */
function positionReturn(holding: Holding) {
  const basis = holding.costUsd;
  const pnlUsd = basis === null ? null : holding.valueUsd - basis;
  const pnlPct =
    basis !== null && basis > 0 ? ((pnlUsd ?? 0) / basis) * 100 : null;
  const positive = (pnlUsd ?? holding.changePct) >= 0;
  return {pnlUsd, pnlPct, positive};
}

/** A token's artwork. Stocks have none, and are never given a stand-in. */
function HoldingAvatar({holding, size}: {holding: Holding; size: number}) {
  const launchpad = useTokenLaunchpad(holding.kind === "token" ? holding.assetId : null);
  return (
    <TokenAvatar
      launchpad={launchpad}
      name={holding.symbol}
      src={
        holding.kind === "token"
          ? holding.logoUrl ||
            tokenFor(holding.assetId)?.imageUrl ||
            loadedLogoFor(holding.assetId)
          : holding.logoUrl
      }
      seed={holding.kind === "token" ? holding.assetId : undefined}
      color={
        holding.kind === "token"
          ? tokenFor(holding.assetId)?.imageColor
          : null
      }
      size={size}
    />
  );
}

const TABLE_COLUMNS =
  "grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_150px] items-center gap-4 px-[18px]";

/**
 * Holdings as a table, for a screen wide enough to line numbers up.
 *
 * Same rows as the list, with the columns a trader scans down: what it is,
 * how much, at what price, worth what, made what, and how much of the
 * portfolio it is.
 */
export function HoldingsTable({
  holdings,
  totalValue,
  empty,
}: {
  holdings: Holding[];
  /** Everything held, ETH included, so allocations sum to the whole. */
  totalValue: number;
  empty: string;
}) {
  if (holdings.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-[13px] leading-[1.5] text-muted">
        {empty}
      </p>
    );
  }

  return (
    <div>
      <div
        aria-hidden="true"
        className={cn(
          TABLE_COLUMNS,
          "border-y border-[var(--overlay-wash)] py-[9px] text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint",
        )}
      >
        <span>Asset</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Price</span>
        <span className="text-right">Value</span>
        <span className="text-right">P&amp;L</span>
        <span className="text-right">Allocation</span>
      </div>

      {holdings.map((holding) => {
        const {pnlUsd, pnlPct, positive} = positionReturn(holding);
        const price = holding.amount > 0 ? holding.valueUsd / holding.amount : null;
        const share = totalValue > 0 ? (holding.valueUsd / totalValue) * 100 : 0;

        return (
          <AssetLink
            key={`${holding.kind}:${holding.assetId}`}
            kind={holding.kind}
            id={holding.assetId}
            className={cn(
              TABLE_COLUMNS,
              "h-[58px] border-b border-[var(--overlay-wash)] text-[13.5px] font-bold transition-colors last:border-b-0 hover:bg-[var(--overlay-wash)]",
            )}
          >
            <span className="flex min-w-0 items-center gap-[11px]">
              {/* The space is kept for a stock, so every name starts on the
                  same line; only the picture is left out. */}
              {holding.kind === "rwa" ? (
                <span aria-hidden="true" className="h-[34px] w-[34px] shrink-0" />
              ) : (
                <HoldingAvatar holding={holding} size={34} />
              )}
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[14px] font-extrabold tracking-[-0.015em]">
                    {holding.symbol}
                  </span>
                  {holding.kind === "rwa" ? <VerifiedTick size={13} /> : null}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] font-semibold text-faint">
                  {holding.name}
                </span>
              </span>
            </span>
            <span className="tabular-nums truncate text-right text-muted">
              {units(holding.amount)}
              {holding.kind === "rwa" ? " shares" : ""}
            </span>
            <span className="tabular-nums truncate text-right text-muted">
              {formatPriceUsd(price)}
            </span>
            <span className="tabular-nums truncate text-right">
              {money(holding.valueUsd)}
            </span>
            <span className="tabular-nums truncate text-right">
              {pnlUsd === null ? (
                <>
                  <PriceDelta value={holding.changePct} />
                  <span className="ml-1.5 text-[11.5px] font-semibold text-faint opacity-75">
                    24h
                  </span>
                </>
              ) : (
                <span className={positive ? "text-price-up" : "text-price-down"}>
                  {positive ? "+" : "−"}
                  {money(Math.abs(pnlUsd))}
                  {pnlPct === null ? null : (
                    <span className="ml-1.5 text-[11.5px] font-semibold opacity-75">
                      <PriceDelta value={pnlPct} />
                    </span>
                  )}
                </span>
              )}
            </span>
            <span className="flex items-center justify-end gap-2">
              <span className="tabular-nums text-muted">{share.toFixed(1)}%</span>
              <span className="h-[5px] w-[64px] overflow-hidden rounded-full bg-[var(--overlay-wash)]">
                <span
                  className="block h-full rounded-full bg-brand-500"
                  style={{width: `${Math.min(100, share)}%`}}
                />
              </span>
            </span>
          </AssetLink>
        );
      })}
    </div>
  );
}

export function HoldingsSkeleton() {
  return (
    <ul className="-mx-[22px]" aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="flex items-center gap-3 px-[22px] py-[13px]">
          <span className="h-[38px] w-[38px] shrink-0 rounded-full bg-wash" />
          <div className="min-w-0 flex-1">
            <span className="block h-3.5 w-16 rounded bg-wash" />
            <span className="mt-2 block h-3 w-24 rounded bg-wash" />
          </div>
          <span className="h-3.5 w-12 rounded bg-wash" />
        </li>
      ))}
    </ul>
  );
}
