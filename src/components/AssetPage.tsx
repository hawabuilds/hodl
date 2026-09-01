"use client";

import {useMemo, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {useAsset, useChart, useNews, useTrades} from "@/hooks/useAsset";
import {cn} from "@/lib/cn";
import {clock, compactMoney, percent, price as fmtPrice, shortAddress} from "@/lib/format";
import {sectorFor} from "@/lib/sectors";
import {assetPath} from "@/lib/routes";
import type {AssetKind, ChartPoint, Timeframe} from "@/lib/types";
import {LaunchpadMark} from "./LaunchpadMark";
import {OrderSheet} from "./OrderSheet";
import {PanelTabs, type PanelTab} from "./PanelTabs";
import {PriceChart} from "./PriceChart";
import {SocialRow} from "./SocialRow";
import {TimeframeRail} from "./TimeframeRail";
import {TradeBar} from "./TradeBar";
import {WatchStar} from "./WatchStar";
import {CommentsPanel} from "./panels/CommentsPanel";
import {InfoPanel} from "./panels/InfoPanel";
import {NewsPanel} from "./panels/NewsPanel";
import {TradesPanel} from "./panels/TradesPanel";
import {Avatar} from "./ui/Avatar";
import {TypeBadge, VerifiedBadge} from "./ui/Badges";
import {ArrowUpRightIcon, ChevronLeftIcon, CopyIcon} from "./ui/Icons";

type PanelKey = "trades" | "comments" | "detail";

/**
 * The chart page, shared by both sides of the universe.
 *
 * One component rather than two because everything below the header is
 * identical — chart, timeframes, trades, comments — and the third tab is the
 * only real fork: a token gets pool and supply stats, an RWA gets coverage.
 */
export function AssetPage({kind, id}: {kind: AssetKind; id: string}) {
  const router = useRouter();
  const {asset, isLoading, error} = useAsset(kind, id);
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [panel, setPanel] = useState<PanelKey>("trades");
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [orderSide, setOrderSide] = useState<"buy" | "sell" | null>(null);

  const chart = useChart(kind, id, timeframe);
  const trades = useTrades(kind, id, panel === "trades");
  const news = useNews(id, kind === "rwa" && panel === "detail");

  const symbol = asset?.kind === "rwa" ? asset.ticker : (asset?.symbol ?? "");
  const contractAddress =
    asset?.kind === "rwa" ? asset.contractAddress : (asset?.address ?? "");

  const windowChange = chart.changePct ?? asset?.changePct ?? 0;
  const positive = windowChange >= 0;

  const tabs: PanelTab<PanelKey>[] = useMemo(
    () => [
      {value: "trades", label: "Trades"},
      {value: "comments", label: "Comments"},
      {value: "detail", label: kind === "rwa" ? "News" : "Info"},
    ],
    [kind],
  );

  if (isLoading) return <AssetSkeleton />;

  if (error || !asset) {
    return (
      <div className="pt-6">
        <BackButton onClick={() => router.push("/home")} />
        <p className="mt-5 text-[14px] text-muted">
          {error?.message ?? "That asset is not listed here."}
        </p>
      </div>
    );
  }

  // While scrubbing, the header reports the point under the finger; otherwise
  // it reports the live price. The change follows the same rule, measured from
  // the start of the visible window.
  const shownPrice = scrubbed?.price ?? asset.priceUsd;
  const openPrice = chart.points[0]?.price ?? asset.priceUsd;
  const shownChange =
    scrubbed && openPrice > 0
      ? ((scrubbed.price - openPrice) / openPrice) * 100
      : windowChange;

  return (
    <div className="pb-[calc(84px+env(safe-area-inset-bottom))]">
      <BackButton onClick={() => router.back()} />

      <div className="mt-3 flex items-start gap-3">
        <Avatar
          name={symbol}
          src={asset.kind === "rwa" ? asset.logoUrl : asset.imageUrl}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate text-[20px] font-extrabold tracking-[-0.03em]">
              {symbol}
            </h1>
            <WatchStar kind={asset.kind} id={asset.id} />
          </div>
          <div className="-mt-0.5 truncate text-[13px] font-semibold text-faint">
            {asset.name}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {asset.kind === "rwa" ? (
          <>
            <VerifiedBadge />
            <TypeBadge type={asset.stockType} />
            {sectorFor(asset.ticker) ? (
              <span
                title={sectorFor(asset.ticker)?.description}
                className="rounded-pill border border-hairline bg-wash px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-muted"
              >
                {sectorFor(asset.ticker)?.label}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <a
              href={asset.launchpad.tokenUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`View on ${asset.launchpad.name}`}
              className="flex items-center gap-1.5 rounded-pill border border-hairline bg-card py-[3px] pl-[3px] pr-2.5 text-[11px] font-extrabold transition-colors hover:border-[var(--border-hover-strong)]"
            >
              <LaunchpadMark launchpad={asset.launchpad} size={18} />
              {asset.launchpad.name}
              <ArrowUpRightIcon className="h-3 w-3 text-faint" />
            </a>
            <Link
              href={assetPath("rwa", asset.pairedTicker)}
              className="rounded-pill border border-hairline bg-wash px-2 py-[5px] text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-muted transition-colors hover:text-ink"
            >
              LP {asset.pairedTicker}
            </Link>
          </>
        )}
        <ContractChip address={contractAddress} />
        {asset.kind === "token" ? (
          <SocialRow socials={asset.socials} className="-my-1" />
        ) : null}
      </div>

      {asset.kind === "rwa" ? (
        <p className="mt-3 text-[13px] leading-[1.55] text-muted">
          {asset.description}
        </p>
      ) : null}

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="tnum text-[32px] font-extrabold leading-none tracking-[-0.035em]">
            {fmtPrice(shownPrice)}
          </div>
          <div
            className={cn(
              "tnum mt-1.5 text-[13.5px] font-bold",
              shownChange >= 0 ? "text-green-deep" : "text-red",
            )}
          >
            {percent(shownChange)}
            <span className="ml-1.5 font-semibold text-faint">
              {scrubbed ? clock(scrubbed.t) : timeframe}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
            {asset.kind === "rwa" ? "Market cap" : "Liquidity"}
          </div>
          <div className="tnum text-[14px] font-extrabold">
            {compactMoney(
              asset.kind === "rwa" ? asset.marketCapUsd : asset.liquidityUsd,
            )}
          </div>
        </div>
      </div>

      <PriceChart
        points={chart.points}
        positive={positive}
        onScrub={setScrubbed}
        className="mt-3"
      />

      <TimeframeRail
        value={timeframe}
        onChange={setTimeframe}
        positive={positive}
        className="mb-5 mt-2"
      />

      <PanelTabs tabs={tabs} value={panel} onChange={setPanel} />

      <div className="pt-3">
        {panel === "trades" ? (
          <TradesPanel
            trades={trades.trades}
            symbol={symbol}
            isLoading={trades.isLoading}
          />
        ) : panel === "comments" ? (
          <CommentsPanel kind={asset.kind} assetId={asset.id} symbol={symbol} />
        ) : asset.kind === "token" ? (
          <InfoPanel token={asset} />
        ) : (
          <NewsPanel
            items={news.items}
            isLoading={news.isLoading}
            seeded={news.seeded}
          />
        )}
      </div>

      <TradeBar
        symbol={symbol}
        onBuy={() => setOrderSide("buy")}
        onSell={() => setOrderSide("sell")}
      />

      <OrderSheet
        asset={orderSide ? asset : null}
        side={orderSide ?? "buy"}
        onClose={() => setOrderSide(null)}
      />
    </div>
  );
}

function BackButton({onClick}: {onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="-ml-1.5 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
    >
      <ChevronLeftIcon className="h-5 w-5" />
    </button>
  );
}

function ContractChip({address}: {address: string}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="flex items-center gap-0.5 rounded-pill border border-hairline bg-card pl-2.5 pr-0.5 text-[11px] font-semibold text-muted">
      <span className="tnum">{copied ? "Copied" : shortAddress(address, 5)}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy contract address"
        className="grid h-6 w-6 place-items-center rounded-full text-faint transition-colors hover:text-ink"
      >
        <CopyIcon className="h-3 w-3" />
      </button>
      <a
        href={addressUrlForChain(address, RH_MAINNET_ID)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View contract on explorer"
        className="grid h-6 w-6 place-items-center rounded-full text-faint transition-colors hover:text-ink"
      >
        <ArrowUpRightIcon className="h-3 w-3" />
      </a>
    </span>
  );
}

function AssetSkeleton() {
  return (
    <div className="pt-2">
      <div className="h-9 w-9 animate-pulse rounded-full bg-wash" />
      <div className="mt-3 flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-full bg-wash" />
        <div className="flex-1">
          <div className="h-4 w-24 animate-pulse rounded bg-wash" />
          <div className="mt-2 h-3 w-36 animate-pulse rounded bg-wash" />
        </div>
      </div>
      <div className="mt-6 h-9 w-40 animate-pulse rounded bg-wash" />
      <div className="mt-4 h-[190px] animate-pulse rounded-panel bg-wash" />
      <div className="mt-4 h-8 animate-pulse rounded-control bg-wash" />
    </div>
  );
}
