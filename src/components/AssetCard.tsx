"use client";

import Link from "next/link";
import {cn} from "@/lib/cn";
import {ageSince, compactMoney, percent, price as fmtPrice} from "@/lib/format";
import {sectorFor} from "@/lib/sectors";
import type {Asset} from "@/lib/types";
import {assetHref} from "@/lib/routes";
import {Sparkline} from "./Sparkline";
import {Avatar} from "./ui/Avatar";
import {PairBadge, VerifiedBadge} from "./ui/Badges";

/**
 * One row in the feed.
 *
 * The two sides of the universe lead with different numbers on purpose: an RWA
 * is read by its share price, a token by its market cap. Forcing them into one
 * column would put a $0.000041 price next to a $682 one and make neither
 * legible.
 */
export function AssetCard({asset}: {asset: Asset}) {
  const positive = asset.changePct >= 0;
  const symbol = asset.kind === "rwa" ? asset.ticker : asset.symbol;

  const primary =
    asset.kind === "rwa" ? fmtPrice(asset.priceUsd) : compactMoney(asset.marketCapUsd);

  const meta =
    asset.kind === "rwa"
      ? [`Vol ${compactMoney(asset.volume24hUsd)}`, sectorFor(asset.ticker)?.label]
      : [
          `Vol ${compactMoney(asset.volume24hUsd)}`,
          `Liq ${compactMoney(asset.liquidityUsd)}`,
          ageSince(asset.createdAt),
        ];

  return (
    <Link
      href={assetHref(asset)}
      className={cn(
        "group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-card border border-hairline bg-card px-3.5 py-[13px] shadow-card",
        "transition-[transform,box-shadow,border-color] duration-200",
        "hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:shadow-lift",
      )}
    >
      <Avatar
        name={symbol}
        src={asset.kind === "rwa" ? asset.logoUrl : asset.imageUrl}
        size={38}
      />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[14.5px] font-extrabold tracking-[-0.01em]">
            {symbol}
          </span>
          {asset.kind === "rwa" ? (
            <VerifiedBadge label="RWA" />
          ) : (
            <PairBadge ticker={asset.pairedTicker} />
          )}
        </div>
        <div className="mt-px truncate text-[12.5px] font-semibold text-faint">
          {asset.name}
        </div>
        <div className="tnum mt-0.5 truncate text-[11.5px] font-semibold text-faint">
          {meta.filter(Boolean).join(" · ")}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Sparkline series={asset.series} positive={positive} className="h-[26px] w-11" />
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="tnum text-[14.5px] font-extrabold tracking-[-0.02em]">
            {primary}
          </span>
          <span
            className={cn(
              "tnum text-[12.5px] font-bold",
              positive ? "text-green-deep" : "text-red",
            )}
          >
            {percent(asset.changePct)}
          </span>
        </div>
      </div>
    </Link>
  );
}
