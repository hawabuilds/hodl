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
import {tokenAge} from "@/lib/format";
import {SECTORS} from "@/lib/sectors";
import {assetHref, assetPath} from "@/lib/routes";
import type {Asset, Timeframe} from "@/lib/types";
import {Sparkline} from "./Sparkline";
import {Avatar} from "./ui/Avatar";
import {TokenAvatar} from "./ui/TokenAvatar";
import {PairTicker, VerifiedTick} from "./ui/Badges";
import {PriceDelta} from "./ui/PriceDelta";

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
  dense = false,
  compact = false,
  sparkline = true,
  pairChip = true,
  active = false,
}: {
  asset: Asset;
  fresh?: boolean;
  eager?: boolean;
  /** This is the asset open beside the list, in the desktop terminal. */
  active?: boolean;
  /** Opens the chart on this interval. New rows pass `1m`. */
  chartTimeframe?: Timeframe;
  /**
   * A 14px side gutter instead of the phone's 22px, for rows inside a desktop
   * column. Only the padding changes — the row itself is the same design on
   * every screen, so a token never reads differently on desktop than on a phone.
   */
  dense?: boolean;
  /**
   * Home's rows, sized by the page: `--home-row`, `--home-logo`,
   * `--home-t-body` and `--home-t-small` shrink on a short laptop window so
   * the whole summary fits one screen. Same content and colours. An RWA gets
   * a ticker badge where a token has its logo, as on Home's design.
   */
  compact?: boolean;
  /** Home's list cards leave the sparkline out; the % stays. */
  sparkline?: boolean;
  /** Off where every row shares the pair, as under one RWA's paired tokens. */
  pairChip?: boolean;
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 transition-colors duration-150 hover:bg-[var(--overlay-wash)]",
        compact ? "h-[var(--home-row,48px)]" : "py-[13px]",
        dense ? "px-3.5" : "px-[22px]",
        active && "bg-[var(--overlay-wash)]",
        fresh && "trade-in",
      )}
    >
      {rwa ? (
        // Home's rows carry the company logo (stored with the RWAs tab's);
        // one without falls back to a coloured circle with the ticker.
        compact ? (
          <Avatar
            className="!h-[var(--home-logo,28px)] !w-[var(--home-logo,28px)]"
            name={symbol}
            src={asset.logoUrl}
            seed={symbol}
            size={28}
            eager={eager}
          />
        ) : null
      ) : (
        <TokenAvatar
          launchpad={token?.launchpad}
          className={
            compact ? "!h-[var(--home-logo,28px)] !w-[var(--home-logo,28px)]" : undefined
          }
          name={symbol}
          src={token?.imageUrl}
          src64={token?.imageUrl64}
          fallbacks={token?.imageFallbacks}
          seed={token?.address}
          color={token?.imageColor}
          size={compact ? 28 : 40}
          eager={eager}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-extrabold tracking-[-0.015em]",
              compact ? "text-[length:var(--home-t-body,14px)] leading-[1.25]" : "text-[15px]",
            )}
          >
            {symbol}
          </span>
          {rwa ? (
            <VerifiedTick />
          ) : (
            <>
              {pairChip ? (
                // 11px on Home, its floor for small text; 10.5px elsewhere.
                <PairTicker
                  ticker={asset.pairedTicker}
                  className={compact ? "!text-[11px]" : undefined}
                />
              ) : null}
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
        <div
          className={cn(
            "tabular-nums flex items-center gap-2.5 truncate font-semibold",
            compact
              ? "mt-[2px] text-[length:var(--home-t-small,12px)] leading-[1.25]"
              : "mt-[3px] text-[12.5px]",
          )}
        >
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

      {sparkline ? (
        <Sparkline
          series={asset.series}
          positive={positive}
          className={cn("shrink-0", compact ? "h-[20px] w-[56px]" : "h-[28px] w-[52px]")}
        />
      ) : null}

      <div
        className={cn(
          "flex shrink-0 flex-col items-end text-right",
          compact ? "gap-[2px]" : "gap-[3px]",
        )}
      >
        <span
          className={cn(
            "tabular-nums font-extrabold tracking-[-0.02em]",
            compact ? "text-[length:var(--home-t-body,14px)] leading-[1.25]" : "text-[15px]",
          )}
        >
          {rwa
            ? formatPriceUsd(shownPrice)
            : formatMarketCapAt(asset, shownPrice)}
          {rwa ? null : (
            <span className="ml-1 text-[11px] font-bold text-faint">MC</span>
          )}
        </span>
        {!rwa && !isPriced(shownPrice) ? (
          <span
            className={cn(
              "tabular-nums font-bold text-faint",
              compact ? "text-[length:var(--home-t-small,12px)] leading-[1.25]" : "text-[12.5px]",
            )}
          >
            —
          </span>
        ) : (
          <PriceDelta
            value={asset.changePct}
            className={cn(
              "font-bold",
              compact ? "text-[length:var(--home-t-small,12px)] leading-[1.25]" : "text-[12.5px]",
            )}
          />
        )}
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
  flush = false,
  dense = false,
  compact = false,
  sparkline = true,
  pairChip = true,
  activePath,
}: {
  assets: Asset[];
  markArrivals?: boolean;
  chartTimeframe?: Timeframe;
  /**
   * Sit inside a bounded container rather than bleeding to the edges of the
   * phone gutter. The feed on a phone undoes `px-[22px]` with `-mx-[22px]`;
   * inside a desktop column that negative margin would spill into the next one.
   */
  flush?: boolean;
  /** Pass-through to each row. See `AssetRow`. */
  dense?: boolean;
  /** Pass-through to each row. See `AssetRow`. */
  compact?: boolean;
  /** Pass-through to each row. See `AssetRow`. */
  sparkline?: boolean;
  /** Pass-through to each row. See `AssetRow`. */
  pairChip?: boolean;
  /** The current route, so the row for the asset on screen can say so. */
  activePath?: string;
}) {
  const current = activePath?.split("?")[0].toLowerCase();
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
    <ul className={flush ? undefined : "-mx-[22px]"}>
      {assets.map((asset, i) => (
        <li key={ids[i]}>
          <AssetRow
            asset={asset}
            fresh={arrivals.has(ids[i])}
            eager={i < 15}
            chartTimeframe={chartTimeframe}
            dense={dense}
            compact={compact}
            sparkline={sparkline}
            pairChip={pairChip}
            active={current === assetPath(asset.kind, asset.id).toLowerCase()}
          />
        </li>
      ))}
    </ul>
  );
}
