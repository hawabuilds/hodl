"use client";

import {useMemo, useState, useEffect} from "react";
import {changePctForPoints, mergeTradesIntoChart} from "@/lib/chartLive";
import {firstPrintContext, hoveredCandleChangePct} from "@/lib/chartLwc";
import {TIMEFRAME_MS, chartWindowMs} from "@/lib/chartPlot";
import {readChartStyle, writeChartStyle} from "@/lib/localStore";
import {formatLiquidityUsd, formatMarketCapAt, formatPriceUsd} from "@/lib/priceState";
import {publishPrice} from "@/lib/livePrice";
import {useLivePrice} from "@/hooks/useLivePrice";
import dynamic from "next/dynamic";
import {useRouter} from "next/navigation";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {useAsset, useChart, useNews, useTrades} from "@/hooks/useAsset";
import {cn} from "@/lib/cn";
import {clock, percent, shortAddress} from "@/lib/format";
import {lastHomePath} from "@/lib/homeState";
import {sectorFor} from "@/lib/sectors";
import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import type {AssetKind, ChartPoint, ChartStyle, Timeframe} from "@/lib/types";
import {RWA_TIMEFRAMES, TIMEFRAMES, timeframeLabel} from "@/lib/types";
import {AssetSkeleton} from "./AssetPageSkeleton";
import {LaunchpadMark} from "./LaunchpadMark";
import {PanelTabs, type PanelTab} from "./PanelTabs";
import {SocialRow} from "./SocialRow";
import {PillRail} from "./PillRail";
import {SegmentedToggle} from "./ui/SegmentedToggle";
import {TradeBar} from "./TradeBar";
import {WatchStar} from "./WatchStar";
import {applyCachedLogo} from "@/lib/tokenLogoCache";
import {Avatar} from "./ui/Avatar";
import {PanelError} from "./panels/TradesPanel";
import {PairMarket, TaxChip, TypeBadge, VerifiedTick} from "./ui/Badges";
import {
  ArrowUpRightIcon,
  CandleChartIcon,
  ChevronLeftIcon,
  CopyIcon,
  LineChartIcon,
} from "./ui/Icons";

const OrderModal = dynamic(
  () => import("./OrderModal").then((m) => ({default: m.OrderModal})),
  {ssr: false},
);
const CommentsPanel = dynamic(() =>
  import("./panels/CommentsPanel").then((m) => ({default: m.CommentsPanel})),
);
const InfoPanel = dynamic(() =>
  import("./panels/InfoPanel").then((m) => ({default: m.InfoPanel})),
);
const NewsPanel = dynamic(() =>
  import("./panels/NewsPanel").then((m) => ({default: m.NewsPanel})),
);
const TradesPanel = dynamic(() =>
  import("./panels/TradesPanel").then((m) => ({default: m.TradesPanel})),
);
const PriceChart = dynamic(
  () => import("./PriceChart").then((m) => ({default: m.PriceChart})),
  {
    ssr: false,
    loading: () => <div className="mt-3 h-[220px] animate-pulse rounded-xl bg-wash" />,
  },
);

type PanelKey = "trades" | "comments" | "detail";

/**
 * The chart page, shared by both sides of the universe.
 *
 * One component rather than two because everything below the header is
 * identical — chart, timeframes, trades, comments — and the third tab is the
 * only real fork: a token gets pool and supply stats, an RWA gets coverage.
 */
export function AssetPage({
  kind,
  id,
  requestedTimeframe,
}: {
  kind: AssetKind;
  id: string;
  /** `?tf=` from the chart URL. New-row clicks send `1m`. */
  requestedTimeframe?: string | null;
}) {
  const router = useRouter();
  const {asset, isLoading, error} = useAsset(kind, id);
  const listedAt = asset?.kind === "token" ? asset.listedAt : null;
  const autoTimeframe = defaultChartTimeframe({
    kind,
    listedAt,
    requested: requestedTimeframe,
  });
  const scope = `${kind}:${id}`;
  const [picked, setPicked] = useState<Timeframe | null>(null);
  const [pickedScope, setPickedScope] = useState<string | null>(null);
  const timeframe =
    pickedScope === scope && picked ? picked : autoTimeframe;
  const setTimeframe = (next: Timeframe) => {
    setPicked(next);
    setPickedScope(scope);
  };
  const tfOptions: readonly Timeframe[] =
    kind === "rwa" ? RWA_TIMEFRAMES : TIMEFRAMES;
  const [panel, setPanel] = useState<PanelKey>("trades");
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [orderSide, setOrderSide] = useState<"buy" | "sell" | null>(null);
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  useEffect(() => {
    setChartStyle(readChartStyle());
  }, []);

  const chart = useChart(kind, id, timeframe);
  const trades = useTrades(kind, id, true);
  const news = useNews(id, kind === "rwa" && panel === "detail");

  const symbol = asset?.kind === "rwa" ? asset.ticker : (asset?.symbol ?? "");
  const contractAddress =
    asset?.kind === "rwa" ? asset.contractAddress : (asset?.address ?? "");

  const livePoints = useMemo(
    () =>
      kind === "rwa"
        ? chart.points
        : mergeTradesIntoChart(
            chart.points,
            trades.trades,
            TIMEFRAME_MS[chart.resolvedTimeframe],
          ),
    [kind, chart.points, chart.resolvedTimeframe, trades.trades],
  );

  // The tape is the freshest thing this app has, so it publishes into the
  // shared price. The feed row for this same asset reads it too, which is what
  // keeps the two surfaces showing one number. RWA prices come from Robinhood
  // quotes, not the DEX tape — mixing the two is what broke the stock axis.
  const newestFill = trades.trades[0];
  useEffect(() => {
    if (kind === "rwa" || !newestFill) return;
    publishPrice(id, newestFill.priceUsd, Date.parse(newestFill.at));
  }, [kind, id, newestFill]);

  const livePrice = useLivePrice(id);
  const liveChange =
    changePctForPoints(livePoints) ??
    chart.changePct ??
    asset?.changePct ??
    0;
  const positive = liveChange >= 0;

  const tabs: PanelTab<PanelKey>[] = useMemo(
    () => [
      {value: "trades", label: "Trades"},
      {value: "comments", label: "Comments"},
      {value: "detail", label: kind === "rwa" ? "News" : "Info"},
    ],
    [kind],
  );

  if (!asset) {
    if (isLoading) return <AssetSkeleton />;
    return (
      <div className="pt-6">
        <BackButton onClick={() => router.push(lastHomePath())} />
        <p className="mt-5 text-[14px] text-muted">
          {error?.message ?? "That asset is not listed here."}
        </p>
      </div>
    );
  }

  const tokenArt = asset.kind === "token" ? applyCachedLogo(asset) : null;

  // While scrubbing, the header reports the point under the finger; otherwise
  // it reports the live price. A hovered candle's % is that bar's open→close,
  // not the cumulative move from the start of the visible window.
  const latestTrade = trades.trades[0];
  const shownPrice =
    scrubbed?.price ??
    livePrice ??
    (kind === "rwa" ? asset.priceUsd : (latestTrade?.priceUsd ?? asset.priceUsd));
  const shownChange = scrubbed
    ? (hoveredCandleChangePct(livePoints, scrubbed) ?? liveChange)
    : liveChange;

  // One calculation, one price. Both live in shared modules precisely so the
  // feed row for this asset and the panel further down this page cannot end up
  // showing a different number from the header.
  const shownMarketCap = formatMarketCapAt(asset, shownPrice);
  const launchContext = firstPrintContext({
    first: livePoints[0],
    listedAt: asset.kind === "token" ? asset.listedAt : null,
    supply: asset.circulatingSupply,
    bucketMs: TIMEFRAME_MS[chart.resolvedTimeframe],
  });

  return (
    <div className="pb-[calc(84px+env(safe-area-inset-bottom))]">
      <BackButton onClick={() => router.back()} />

      {asset.kind === "rwa" ? (
        // Robinhood lists equities without artwork, so the name carries the
        // header on its own.
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-faint">
              {asset.ticker}
            </span>
            <VerifiedTick size={14} />
            <TypeBadge type={asset.stockType} />
            <WatchStar kind={asset.kind} id={asset.id} className="-my-1 ml-auto" />
          </div>
          <h1 className="mt-1 text-[24px] font-extrabold leading-tight tracking-[-0.035em]">
            {asset.name}
          </h1>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3">
          <Avatar
            name={symbol}
            src={tokenArt?.imageUrl}
            src64={tokenArt?.imageUrl64}
            fallbacks={tokenArt?.imageFallbacks}
            seed={asset.address}
            color={tokenArt?.imageColor}
            size={44}
            eager
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
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {asset.kind === "rwa" ? (
          sectorFor(asset.ticker) ? (
            <span
              title={sectorFor(asset.ticker)?.description}
              className="rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-muted"
            >
              {sectorFor(asset.ticker)?.label}
            </span>
          ) : null
        ) : (
          <>
            <PairMarket base={asset.symbol} quote={asset.pairedTicker} />
            <TaxChip buyPct={asset.buyTaxPct} sellPct={asset.sellTaxPct} />
            {asset.launchpad ? (
              <a
                href={asset.launchpad.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Launched on ${asset.launchpad.name}`}
                className="flex items-center gap-1.5 rounded-[8px] bg-[var(--overlay-wash)] py-1 pl-1 pr-2 text-[11.5px] font-extrabold transition-colors hover:bg-[var(--overlay-wash-hover)]"
              >
                <LaunchpadMark launchpad={asset.launchpad} size={16} />
                {asset.launchpad.name}
              </a>
            ) : null}
          </>
        )}
        {asset.kind === "token" ? (
          <SocialRow socials={asset.socials} className="-my-1" />
        ) : null}
      </div>

      {/*
        The contract sits on its own line rather than in the rail above. It is
        the longest chip by far and the only one people copy rather than read,
        so sharing a wrapping row with the pair, tax and launchpad pushed those
        around depending on address length.
      */}
      <div className="mt-2 flex">
        <ContractChip address={contractAddress} />
      </div>

      {asset.kind === "rwa" ? (
        <p className="mt-3 text-[13px] leading-[1.55] text-muted">
          {asset.description}
        </p>
      ) : null}

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="tnum text-[32px] font-extrabold leading-none tracking-[-0.035em]">
            {formatPriceUsd(shownPrice)}
          </div>
          <div
            className={cn(
              "tnum mt-1.5 text-[13.5px] font-bold",
              asset.kind === "token" && shownMarketCap === "—"
                ? "text-faint"
                : shownChange >= 0
                  ? "text-green-deep"
                  : "text-red",
            )}
          >
            {asset.kind === "token" && shownMarketCap === "—"
              ? "—"
              : percent(shownChange)}
            <span className="ml-1.5 font-semibold text-faint">
              {scrubbed
                ? clock(scrubbed.t)
                : timeframeLabel(timeframe, chart.resolvedTimeframe)}
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            Market cap
          </div>
          <div className="tnum text-[15px] font-extrabold tracking-[-0.02em]">
            {shownMarketCap}
          </div>
          {asset.kind === "token" ? (
            <div className="tnum mt-0.5 inline-flex items-center gap-1 rounded-[6px] bg-[var(--overlay-wash)] px-1.5 py-[3px] text-[11px] font-bold">
              <span className="text-faint">Liq</span>
              <span className="text-muted">
                {formatLiquidityUsd(asset.liquidityUsd)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {chart.error && livePoints.length < 2 ? (
        <div className="mt-3 h-[220px] rounded-xl bg-wash">
          <PanelError message={chart.error} onRetry={chart.retry} />
        </div>
      ) : (
        <PriceChart
          points={livePoints}
          positive={positive}
          windowMs={chartWindowMs(timeframe)}
          emptyLabel={`Not enough history for ${timeframe}`}
          style={chartStyle}
          showBaseline={asset.kind !== "token"}
          floorPrice={launchContext?.price ?? livePoints[0]?.price}
          onNeedOlder={chart.hasMore ? chart.loadOlder : undefined}
          onScrub={setScrubbed}
          className="mt-3"
        />
      )}

      <div className="mb-5 mt-2 flex items-center gap-2">
        <PillRail
          label="Chart timeframe"
          options={tfOptions}
          value={timeframe}
          resolvedValue={chart.resolvedTimeframe}
          onChange={setTimeframe}
          positive={positive}
          className="mb-0 mt-0 min-w-0 flex-1"
        />
        <SegmentedToggle
          value={chartStyle}
          onChange={(next) => {
            setChartStyle(next);
            writeChartStyle(next);
          }}
          options={[
            {value: "line", label: "Line", icon: <LineChartIcon className="h-3.5 w-3.5" />},
            {
              value: "candles",
              label: "Candles",
              icon: <CandleChartIcon className="h-3.5 w-3.5" />,
            },
          ]}
        />
      </div>

      <PanelTabs tabs={tabs} value={panel} onChange={setPanel} />

      <div className="pt-3">
        {panel === "trades" ? (
          <TradesPanel
            trades={trades.trades}
            symbol={symbol}
            isLoading={trades.isLoading}
            error={trades.error}
            onRetry={trades.retry}
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
            error={news.error}
            onRetry={news.retry}
          />
        )}
      </div>

      <TradeBar
        symbol={symbol}
        onBuy={() => setOrderSide("buy")}
        onSell={() => setOrderSide("sell")}
      />

      <OrderModal
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
    <span className="flex items-center gap-0.5 rounded-[8px] bg-[var(--overlay-wash)] py-0.5 pl-2 pr-0.5 text-[11.5px] font-semibold text-muted">
      <span className="font-mono text-[11px]">
        {copied ? "Copied" : shortAddress(address, 5)}
      </span>
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
