"use client";

import Link from "next/link";
import {useArrivals} from "@/hooks/useArrivals";
import {usePrefetchAsset} from "@/hooks/usePrefetchAsset";
import {cn} from "@/lib/cn";
import {compactMoney, percent, price as fmtPrice} from "@/lib/format";
import {SECTORS} from "@/lib/sectors";
import {assetHref} from "@/lib/routes";
import type {Asset} from "@/lib/types";
import {Sparkline} from "./Sparkline";
import {Avatar} from "./ui/Avatar";
import {PairTicker, VerifiedTick} from "./ui/Badges";

const SECTOR_LABEL = new Map(SECTORS.map((sector) => [sector.id, sector.label]));

/**
 * One row in the feed.
 *
 * Deliberately not a card. A feed is scanned down a single column of tickers,
 * and boxing each entry puts a border between the eye and the next symbol.
 *
 * The two sides of the universe differ in exactly two ways, both of them
 * following what a brokerage already does: a tokenized stock carries no mark at
 * all, because Robinhood lists equities by symbol alone, and its second line is
 * the sector rather than pool volume, because that is what a stock is grouped
 * by.
 */
export function AssetRow({asset, fresh}: {asset: Asset; fresh?: boolean}) {
  const prefetch = usePrefetchAsset();
  const warm = () => prefetch(asset.kind, asset.id);
  const positive = asset.changePct >= 0;
  const rwa = asset.kind === "rwa";
  const symbol = rwa ? asset.ticker : asset.symbol;

  return (
    <Link
      href={assetHref(asset)}
      prefetch
      // Pointer-down rather than click: the page's data starts loading while
      // the finger is still on the row, which is most of the gap a first tap
      // used to spend staring at a skeleton. `onMouseEnter` covers a cursor,
      // which has even longer to work with.
      onPointerDown={warm}
      onMouseEnter={warm}
      className={cn(
        "flex items-center gap-3 px-[22px] py-[13px] transition-colors duration-150 hover:bg-[var(--overlay-wash)]",
        fresh && "trade-in",
      )}
    >
      {rwa ? null : (
        <Avatar
          name={symbol}
          src={asset.imageUrl}
          fallbackSrc={asset.launchpad?.logoUrl}
          size={40}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
            {symbol}
          </span>
          {rwa ? (
            <VerifiedTick />
          ) : (
            <PairTicker ticker={asset.pairedTicker} />
          )}
        </div>
        <div className="tnum mt-[3px] truncate text-[12.5px] font-semibold text-faint">
          {rwa
            ? (SECTOR_LABEL.get(asset.sector) ?? asset.name)
            : `${compactMoney(asset.volume24hUsd)} Vol`}
        </div>
      </div>

      <Sparkline
        series={asset.series}
        positive={positive}
        className="h-[28px] w-[52px] shrink-0"
      />

      <div className="flex shrink-0 flex-col items-end gap-[3px] text-right">
        <span className="tnum text-[15px] font-extrabold tracking-[-0.02em]">
          {rwa ? fmtPrice(asset.priceUsd) : compactMoney(asset.marketCapUsd)}
          {rwa ? null : (
            <span className="ml-1 text-[11px] font-bold text-faint">MC</span>
          )}
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
    </Link>
  );
}

/**
 * A fluid list of rows — no boxes, no rules, just the tickers.
 *
 * With `markArrivals`, rows that were not in the previous update slide in. Used
 * by the feed's newest-first views, where a token appearing at the top is the
 * whole point of the view.
 */
export function AssetList({
  assets,
  markArrivals = false,
}: {
  assets: Asset[];
  markArrivals?: boolean;
}) {
  const ids = assets.map((asset) => `${asset.kind}:${asset.id}`);
  const arrivals = useArrivals(markArrivals ? ids : []);

  return (
    <ul className="-mx-[22px]">
      {assets.map((asset, i) => (
        <li key={ids[i]}>
          <AssetRow asset={asset} fresh={arrivals.has(ids[i])} />
        </li>
      ))}
    </ul>
  );
}
