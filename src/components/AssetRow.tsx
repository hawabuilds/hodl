"use client";

import Link from "next/link";
import {useEffect} from "react";
import {useArrivals} from "@/hooks/useArrivals";
import {useFeedLogos} from "@/hooks/useFeedLogos";
import {usePrefetchAsset} from "@/hooks/usePrefetchAsset";
import {applyCachedToken, rememberTokens} from "@/lib/tokenCache";
import {useLivePrice} from "@/hooks/useLivePrice";
import {formatMarketCapAt, formatPriceUsd, formatVolumeUsd, isPriced} from "@/lib/priceState";
import {cn} from "@/lib/cn";
import {percent, tokenAge} from "@/lib/format";
import {SECTORS} from "@/lib/sectors";
import {assetHref} from "@/lib/routes";
import type {Asset, Timeframe} from "@/lib/types";
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
export function AssetRow({
  asset,
  fresh,
  eager = false,
  chartTimeframe,
}: {
  asset: Asset;
  fresh?: boolean;
  eager?: boolean;
  /** Opens the chart on this interval. New rows pass `1m`. */
  chartTimeframe?: Timeframe;
}) {
  const prefetch = usePrefetchAsset();
  // The same shared price the chart page publishes into, so a row and the page
  // it opens show one market cap rather than two.
  const livePrice = useLivePrice(asset.id);
  const token = asset.kind === "token" ? applyCachedToken(asset) : null;
  const shownPrice = livePrice ?? asset.priceUsd;
  const warm = () => prefetch(asset.kind, asset.id, chartTimeframe);
  const positive = asset.changePct >= 0;
  const rwa = asset.kind === "rwa";
  const symbol = rwa ? asset.ticker : asset.symbol;

  return (
    <Link
      href={assetHref(asset, chartTimeframe)}
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
          src={token?.imageUrl}
          src64={token?.imageUrl64}
          fallbacks={token?.imageFallbacks}
          seed={token?.address}
          color={token?.imageColor}
          size={40}
          eager={eager}
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
            <>
              <PairTicker ticker={asset.pairedTicker} />
              {asset.tradeable === false ? (
                <span
                  title="Pool liquidity is below the tradeable floor"
                  className="inline-flex shrink-0 items-center rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px] text-[10.5px] font-extrabold uppercase leading-none tracking-[0.03em] text-faint"
                >
                  No liquidity
                </span>
              ) : null}
            </>
          )}
        </div>
        <div className="tnum mt-[3px] flex items-center gap-2.5 truncate text-[12.5px] font-semibold">
          {rwa ? (
            <span className="text-faint">
              {SECTOR_LABEL.get(asset.sector) ?? asset.name}
            </span>
          ) : (
            <>
              <span className="text-faint">
                {token && token.rewards24hUsd > 0
                  ? `${formatVolumeUsd(token.rewards24hUsd)} Rewards`
                  : `${formatVolumeUsd(asset.volume24hUsd)} Vol`}
              </span>
              <span className="text-muted">{tokenAge(asset.createdAt)}</span>
            </>
          )}
        </div>
      </div>

      <Sparkline
        series={asset.series}
        positive={positive}
        className="h-[28px] w-[52px] shrink-0"
      />

      <div className="flex shrink-0 flex-col items-end gap-[3px] text-right">
        <span className="tnum text-[15px] font-extrabold tracking-[-0.02em]">
          {rwa
            ? formatPriceUsd(shownPrice)
            : formatMarketCapAt(asset, shownPrice)}
          {rwa ? null : (
            <span className="ml-1 text-[11px] font-bold text-faint">MC</span>
          )}
        </span>
        <span
          className={cn(
            "tnum text-[12.5px] font-bold",
            !rwa && !isPriced(shownPrice)
              ? "text-faint"
              : positive
                ? "text-green-deep"
                : "text-red",
          )}
        >
          {!rwa && !isPriced(shownPrice) ? "—" : percent(asset.changePct)}
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
  chartTimeframe,
}: {
  assets: Asset[];
  markArrivals?: boolean;
  chartTimeframe?: Timeframe;
}) {
  const tokens = assets.filter((asset): asset is Extract<Asset, {kind: "token"}> => asset.kind === "token");
  const logoKey = tokens
    .map((token) => `${token.address}:${token.imageUrl ?? ""}:${token.imageUrl64 ?? ""}`)
    .join("|");
  useEffect(() => {
    rememberTokens(tokens);
    // logoKey is the membership + artwork identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoKey]);
  const ids = assets.map((asset) => `${asset.kind}:${asset.id}`);
  const arrivals = useArrivals(markArrivals ? ids : []);
  const logos = assets.map((asset) => {
    if (asset.kind !== "token") return null;
    const token = applyCachedToken(asset);
    return token.imageUrl64 || token.imageUrl;
  });
  useFeedLogos(logos);

  return (
    <ul className="-mx-[22px]">
      {assets.map((asset, i) => (
        <li key={ids[i]}>
          <AssetRow
            asset={asset}
            fresh={arrivals.has(ids[i])}
            eager={i < 15}
            chartTimeframe={chartTimeframe}
          />
        </li>
      ))}
    </ul>
  );
}
