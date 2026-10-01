"use client";

import {memo, useState, type MouseEvent} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useQuery} from "@tanstack/react-query";

import {usePrefetchAsset} from "@/hooks/usePrefetchAsset";
import {cn} from "@/lib/cn";
import {tokenAge} from "@/lib/format";
import {formatLiquidityUsd, formatMarketCapAt, formatVolumeUsd} from "@/lib/priceState";
import {assetPath} from "@/lib/routes";
import {countLabel, type TokensTableRow} from "@/lib/tokensTable";
import {applyCachedToken} from "@/lib/tokenCache";
import {Sparkline} from "../../Sparkline";
import {TokenAvatar} from "../../ui/TokenAvatar";
import {GlobeIcon, TelegramIcon, XIcon} from "../../ui/Icons";

/**
 * The table's column template. One literal class, shared by the header and
 * every row, so each title sits over its values: Token, Socials, 24h chart,
 * Age, Market cap, 24h %, Liquidity, Volume, Buys / Sells, Buy.
 */
export const TABLE_COLUMNS =
  "grid grid-cols-[minmax(0,34fr)_96px_110px_minmax(0,12fr)_minmax(0,19fr)_minmax(0,17fr)_minmax(0,19fr)_minmax(0,19fr)_minmax(0,20fr)_76px] items-center gap-3 px-5";

function stop(event: MouseEvent) {
  event.stopPropagation();
}

/** The paired stock, with its real market move on hover. */
function StockBadge({ticker}: {ticker: string}) {
  const [hovered, setHovered] = useState(false);
  const isStock = ticker !== "USDG" && ticker !== "WETH" && ticker !== "";
  const today = useQuery({
    queryKey: ["rwa-today", ticker],
    enabled: hovered && isStock,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/rwa/${encodeURIComponent(ticker)}/today`);
      if (!res.ok) throw new Error("no move");
      return (await res.json()) as {changePct: number | null; label: "today" | "last session" | null};
    },
  });
  const move = today.data?.changePct;
  const up = move != null && move >= 0;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px] text-[11px] font-extrabold leading-none tracking-[0.02em] text-muted">
        {ticker}
      </span>
      {hovered && isStock ? (
        <span
          role="tooltip"
          data-surface="popup"
          className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface-popup px-2.5 py-1.5 text-[12px] font-bold shadow-panel"
        >
          {ticker}{" "}
          {move == null ? (
            <span className="text-faint">{today.isError ? "move unavailable" : "…"}</span>
          ) : (
            <>
              <span className={up ? "text-price-up" : "text-price-down"}>
                {up ? "▲" : "▼"}
                {Math.abs(move).toFixed(1)}%
              </span>{" "}
              <span className="font-semibold text-faint">{today.data?.label ?? "today"}</span>
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}

function Socials({row}: {row: TokensTableRow}) {
  const {x, website, telegram} = row.asset.socials ?? {};
  const links = [
    x ? {href: x, label: "X", Icon: XIcon} : null,
    website ? {href: website, label: "Website", Icon: GlobeIcon} : null,
    telegram ? {href: telegram, label: "Telegram", Icon: TelegramIcon} : null,
  ].filter((link): link is NonNullable<typeof link> => link != null);
  return (
    <div className="flex items-center justify-center gap-0.5">
      {links.map(({href, label, Icon}) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${row.asset.symbol} on ${label}`}
          title={label}
          onClick={stop}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
        >
          <Icon style={{width: 15, height: 15}} />
        </a>
      ))}
    </div>
  );
}

export const TokenTableRowView = memo(function TokenTableRowView({
  row,
  buying,
  onBuy,
}: {
  row: TokensTableRow;
  buying: boolean;
  onBuy: (row: TokensTableRow) => void;
}) {
  const router = useRouter();
  const prefetch = usePrefetchAsset();
  const asset = applyCachedToken(row.asset);
  const href = assetPath("token", asset.address);
  const change = asset.changePct;
  const up = change >= 0;
  const listed = asset.listedAt ?? asset.createdAt;
  const warm = () => prefetch("token", asset.address);

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter") router.push(href);
      }}
      onMouseEnter={warm}
      className={cn(
        TABLE_COLUMNS,
        "group min-h-[62px] cursor-pointer py-2.5 transition-colors hover:bg-[var(--overlay-wash)] focus-visible:bg-[var(--overlay-wash)] focus-visible:outline-none",
      )}
    >
      {/* Token */}
      <div className="flex min-w-0 items-center gap-3">
        <TokenAvatar
          launchpad={asset.launchpad}
          name={asset.symbol}
          src={asset.imageUrl}
          src64={asset.imageUrl64}
          fallbacks={asset.imageFallbacks}
          seed={asset.address}
          color={asset.imageColor}
          size={40}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={href}
              prefetch={false}
              onClick={stop}
              className="truncate text-[15px] font-extrabold tracking-[-0.015em] hover:text-accent-link"
            >
              {asset.symbol}
            </Link>
            {asset.pairedTicker ? <StockBadge ticker={asset.pairedTicker} /> : null}
          </div>
          {/* The full name, never cut off: it wraps instead. */}
          <div className="mt-0.5 break-words text-[12px] leading-[1.35] text-faint">{asset.name}</div>
        </div>
      </div>

      <Socials row={row} />

      <div className="h-7 w-[110px]">
        {asset.series.length > 1 ? (
          <Sparkline series={asset.series} positive={up} height={28} className="h-7 w-[110px]" />
        ) : null}
      </div>

      <span className="tabular-nums text-right text-[14px] text-muted">
        {listed ? tokenAge(listed) : "—"}
      </span>
      <span className="tabular-nums text-right text-[14px] font-bold">
        {formatMarketCapAt(asset, asset.priceUsd)}
      </span>
      <span
        className={cn(
          "tabular-nums text-center text-[14px] font-bold",
          up ? "text-price-up" : "text-price-down",
        )}
      >
        {Number.isFinite(change) ? `${up ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}%` : "—"}
      </span>
      <span className="tabular-nums text-right text-[14px] font-semibold">
        {formatLiquidityUsd(asset.liquidityUsd)}
      </span>
      <span className="tabular-nums text-right text-[14px] font-semibold">
        {formatVolumeUsd(asset.volume24hUsd)}
      </span>
      <span className="tabular-nums text-right text-[14px] font-semibold">
        {row.buys == null && row.sells == null ? (
          <span className="text-faint">—</span>
        ) : (
          <>
            <span className="text-price-up">{countLabel(row.buys)}</span>
            <span className="text-faint"> / </span>
            <span className="text-price-down">{countLabel(row.sells)}</span>
          </>
        )}
      </span>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onBuy(row);
          }}
          disabled={buying}
          className={cn(
            "rounded-[10px] bg-brand-500 px-3.5 py-2 text-[13px] font-extrabold text-white transition-opacity",
            buying
              ? "opacity-100"
              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {buying ? "Buying…" : "Buy"}
        </button>
      </div>
    </div>
  );
});
