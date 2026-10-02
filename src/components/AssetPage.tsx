"use client";

import {useCallback, useMemo, useRef, useState, useEffect} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {normalizeAddress} from "@/lib/address";
import {startAssetBundle} from "@/hooks/assetBundle";
import {useCommentTarget} from "@/lib/alertBus";
import {mergeTradesIntoChart} from "@/lib/chartLive";
import {changeFromViewStart, headerChange, tokenHeaderPrice} from "@/lib/chartHeader";
import {firstPrintContext} from "@/lib/chartLwc";
import {TIMEFRAME_MS, chartWindowMs} from "@/lib/chartPlot";
import {readChartStyle, writeChartStyle} from "@/lib/localStore";
import {formatLiquidityUsd, formatMarketCapAt} from "@/lib/priceState";
import {formatSubscriptUsd} from "@/lib/priceFormat";
import {publishPrice} from "@/lib/livePrice";
import {useLivePrice} from "@/hooks/useLivePrice";
import dynamic from "next/dynamic";
import {useRouter} from "next/navigation";
import {useIsDesktop} from "@/hooks/useBreakpoint";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {useAsset, useChart, useHourlyReference, useNews, useTrades} from "@/hooks/useAsset";
import {cn} from "@/lib/cn";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {shortAddress} from "@/lib/format";
import {PriceDelta} from "./ui/PriceDelta";
import {lastHomePath} from "@/lib/homeState";
import {sectorFor} from "@/lib/sectors";
import {defaultChartTimeframe, parseRequestedTimeframe} from "@/lib/chartTimeframe";
import type {AssetKind, ChartPoint, ChartStyle, Timeframe} from "@/lib/types";
import {RWA_TIMEFRAMES, TIMEFRAMES} from "@/lib/types";
import {AssetSkeleton} from "./AssetPageSkeleton";
import {LaunchpadMark} from "./LaunchpadMark";
import {PanelTabs, type PanelTab} from "./PanelTabs";
import {SocialRow} from "./SocialRow";
import {PillRail} from "./PillRail";
import {SegmentedToggle} from "./ui/SegmentedToggle";
import {TradeBar} from "./TradeBar";
import {WatchStar} from "./WatchStar";
import {applyCachedLogo} from "@/lib/tokenLogoCache";
import {TokenAvatar} from "./ui/TokenAvatar";
import {NewsCard} from "./panels/NewsCard";
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
const OrderTicket = dynamic(
  () => import("./OrderModal").then((m) => ({default: m.OrderTicket})),
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
  const desktop = useIsDesktop();
  // Opened directly, with nothing cached: one bundle request feeds the asset,
  // chart and trades queries below (see hooks/assetBundle). Started in render
  // so it is in flight before those queries fetch.
  const queryClient = useQueryClient();
  const bundleScope = `${kind}:${kind === "token" ? normalizeAddress(id) : id}`;
  const bundleStarted = useRef<string | null>(null);
  if (bundleStarted.current !== bundleScope) {
    bundleStarted.current = bundleScope;
    const key = kind === "token" ? normalizeAddress(id) : id;
    if (!queryClient.getQueryData(["asset", kind, key])) {
      // No timeframe in the URL: the server picks the page's default (it
      // knows the token's age), so the chart it sends is the one shown.
      startAssetBundle(kind, key, parseRequestedTimeframe(requestedTimeframe, kind));
    }
  }
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
  // A Following row, the bell or a pop-up links here with #comments or
  // #comment-<id>: open on Comments, at that comment.
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const openComments = useCallback((commentId: string | null) => {
    setPanel("comments");
    setCommentTarget(commentId);
  }, []);
  useCommentTarget(openComments, `${kind}:${id}`);
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [viewStart, setViewStart] = useState<ChartPoint | null>(null);
  const onScrub = useCallback((point: ChartPoint | null, start?: ChartPoint | null) => {
    setScrubbed(point);
    setViewStart(point ? (start ?? null) : null);
  }, []);
  // Up or down across the bars in view — the line's colour, and the pills'.
  const [positive, setPositive] = useState(true);
  const [orderSide, setOrderSide] = useState<"buy" | "sell" | null>(null);
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  useEffect(() => {
    setChartStyle(readChartStyle());
  }, []);

  // The chart waits for the asset: its default timeframe depends on the
  // token's age, and both arrive in the same bundle anyway.
  const chart = useChart(kind, id, timeframe, Boolean(asset));
  // The header, chart and trades appear together: the page's one skeleton
  // stays up until the chart is in too, for at most 1.5s, rather than showing
  // an empty chart box that fills in after.
  const [chartWaitOver, setChartWaitOver] = useState(false);
  useEffect(() => {
    setChartWaitOver(false);
    const timer = window.setTimeout(() => setChartWaitOver(true), 1_500);
    return () => window.clearTimeout(timer);
  }, [scope]);
  const hourly = useHourlyReference(kind, id);
  const trades = useTrades(kind, id, true);
  // A stock's news sits under the order ticket on a desktop, so it loads with
  // the page there; on a phone it waits for its tab.
  const newsInAside = desktop && kind === "rwa";
  const news = useNews(id, kind === "rwa" && (panel === "detail" || newsInAside));

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

  // On desktop a token's Info sits permanently beside the ticket, so it is not
  // also a tab; a stock's News has no such home and stays one.
  // On a desktop a token's Info and a stock's News live in the right column,
  // so neither is a tab under the chart there.
  const detailInAside = (desktop && kind === "token") || newsInAside;
  const tabs: PanelTab<PanelKey>[] = useMemo(
    () => [
      {value: "trades", label: "Trades"},
      {value: "comments", label: "Comments"},
      ...(detailInAside
        ? []
        : [{value: "detail" as const, label: kind === "rwa" ? "News" : "Info"}]),
    ],
    [kind, detailInAside],
  );
  const shownPanel: PanelKey = detailInAside && panel === "detail" ? "trades" : panel;

  if (!asset) {
    if (isLoading) return <AssetSkeleton />;
    return (
      <div className={APP_SCROLL_PAD_TOP}>
        <BackButton onClick={() => router.push(lastHomePath())} />
        <p className="mt-5 text-[14px] text-muted">
          {error?.message ?? "That asset is not listed here."}
        </p>
      </div>
    );
  }

  if (chart.isLoading && !chart.error && !chartWaitOver) return <AssetSkeleton />;

  const tokenArt = asset.kind === "token" ? applyCachedLogo(asset) : null;

  // While scrubbing, the header reports the point under the finger and how
  // far it is from the first bar in view; otherwise the live price and its
  // 24h change (or since launch, for a token younger than a day).
  // A token's header is its chart's last point: the newest on-chain trade in
  // the pool the chart and trades list read. A stock's is the Robinhood quote.
  const currentPrice =
    kind === "rwa"
      ? (livePrice ?? asset.priceUsd)
      : tokenHeaderPrice({
          chartPoints: livePoints,
          trades: trades.trades,
          providerPrice: asset.priceUsd,
        });
  const shownPrice = scrubbed?.price ?? currentPrice;
  // The ticket quotes "per token" and values a sell from the same price the
  // header shows, not the provider's, which can be a stored price weeks old.
  const tradeAsset =
    asset.kind === "token" && currentPrice != null ? {...asset, priceUsd: currentPrice} : asset;

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
  const dayChange = headerChange({
    asset: {
      kind: asset.kind,
      priceUsd: asset.priceUsd,
      changePct: asset.changePct,
      listedAt: asset.kind === "token" ? asset.listedAt : null,
    },
    livePrice: currentPrice,
    launchPrice: launchContext?.label === "Launch" ? launchContext.price : null,
    hourly,
  });
  const fromViewStart = scrubbed ? changeFromViewStart(scrubbed.price, viewStart?.price) : null;

  const chipItems = (
    <>
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
    </>
  );

  const priceFigure = (
    <div className={desktop ? "text-right" : undefined}>
      <div className="tabular-nums text-[32px] font-extrabold leading-none tracking-[-0.035em]">
        {formatSubscriptUsd(shownPrice)}
      </div>
      <div
        className={cn(
          "mt-1.5 flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold",
          desktop && "justify-end",
        )}
      >
        {asset.kind === "token" && shownMarketCap === "—" ? (
          <span className="tabular-nums text-faint">—</span>
        ) : scrubbed ? (
          <>
            <PriceDelta value={fromViewStart ?? Number.NaN} />
            <span className="font-semibold text-faint">from start of view</span>
          </>
        ) : (
          <>
            <PriceDelta value={dayChange.pct ?? Number.NaN} />
            <span className="font-semibold text-faint">{dayChange.label}</span>
          </>
        )}
      </div>
    </div>
  );

  const capFigure = (
    <div className="shrink-0 text-right">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
        Market cap
      </div>
      <div className="tabular-nums text-[15px] font-extrabold tracking-[-0.02em]">
        {shownMarketCap}
      </div>
      {asset.kind === "token" ? (
        <div className="tabular-nums mt-0.5 inline-flex items-center gap-1 rounded-[6px] bg-[var(--overlay-wash)] px-1.5 py-[3px] text-[11px] font-bold">
          <span className="text-faint">Liq</span>
          <span className="text-muted">
            {formatLiquidityUsd(asset.liquidityUsd)}
          </span>
        </div>
      ) : null}
    </div>
  );

  // A phone stacks the name, the chips, the contract and the price, because it
  // has the height and not the width. A desktop pane is the other way round:
  // stacked, those rows pushed the chart and the trades under it off the
  // screen, so the name, price and cap share a row and the chips share another.
  const header = desktop ? (
    <>
      <div className="flex items-center gap-5">
        {asset.kind === "rwa" ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-faint">
                {asset.ticker}
              </span>
              <VerifiedTick size={14} />
              <TypeBadge type={asset.stockType} />
              <WatchStar
                kind={asset.kind}
                id={asset.id}
                addPrice={asset.priceUsd}
                className="-my-1"
              />
            </div>
            <h1 className="mt-0.5 truncate text-[20px] font-extrabold leading-tight tracking-[-0.03em]">
              {asset.name}
            </h1>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <TokenAvatar
              launchpad={asset.launchpad}
              name={symbol}
              src={tokenArt?.imageUrl}
              src64={tokenArt?.imageUrl64}
              fallbacks={tokenArt?.imageFallbacks}
              seed={asset.address}
              color={tokenArt?.imageColor}
              size={40}
              eager
            />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <h1 className="truncate text-[19px] font-extrabold tracking-[-0.03em]">
                  {symbol}
                </h1>
                <WatchStar kind={asset.kind} id={asset.id} addPrice={asset.priceUsd} />
              </div>
              <div className="-mt-0.5 truncate text-[13px] font-semibold text-faint">
                {asset.name}
              </div>
            </div>
          </div>
        )}
        {priceFigure}
        {capFigure}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {chipItems}
        <ContractChip address={contractAddress} />
      </div>

      {asset.kind === "rwa" ? (
        <p
          title={asset.description}
          className="mt-2.5 line-clamp-2 text-[13px] leading-[1.55] text-muted"
        >
          {asset.description}
        </p>
      ) : null}
    </>
  ) : (
    <>
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
            <WatchStar kind={asset.kind} id={asset.id} addPrice={asset.priceUsd} className="-my-1 ml-auto" />
          </div>
          <h1 className="mt-1 text-[24px] font-extrabold leading-tight tracking-[-0.035em]">
            {asset.name}
          </h1>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3">
          <TokenAvatar
            launchpad={asset.launchpad}
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
              <WatchStar kind={asset.kind} id={asset.id} addPrice={asset.priceUsd} />
            </div>
            <div className="-mt-0.5 truncate text-[13px] font-semibold text-faint">
              {asset.name}
            </div>
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {chipItems}
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
        {priceFigure}
        {capFigure}
      </div>
    </>
  );

  const content = (
    <>
      {header}

      {chart.error && livePoints.length < 2 ? (
        <div className="mt-3 h-[220px] rounded-xl bg-wash">
          <PanelError message={chart.error} onRetry={chart.retry} />
        </div>
      ) : chart.isLoading ? (
        // History not back yet. The tape alone would draw a few hours of
        // bars and then jump, and "Not enough history" would be untrue.
        <ChartSkeleton height={desktop ? "clamp(220px, 32vh, 380px)" : 190} />
      ) : (
        <PriceChart
          points={livePoints}
          live
          onTrend={setPositive}
          // The bars on screen, not the pill: while a new timeframe loads the
          // last one stays up, and the view must refit when the new one lands.
          windowMs={chartWindowMs(chart.resolvedTimeframe)}
          emptyLabel={`Not enough history for ${timeframe}`}
          style={chartStyle}
          floorPrice={launchContext?.price ?? livePoints[0]?.price}
          onNeedOlder={chart.hasMore ? chart.loadOlder : undefined}
          onScrub={onScrub}
          height={desktop ? "clamp(220px, 32vh, 380px)" : undefined}
          // The last timeframe, dimmed, until the new one arrives.
          className={cn("mt-3 transition-opacity duration-200", chart.isSwitching && "opacity-50")}
        />
      )}

      <div className="mb-5 mt-2 flex items-center gap-2">
        <PillRail
          label="Chart timeframe"
          options={tfOptions}
          value={timeframe}
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

      <PanelTabs tabs={tabs} value={shownPanel} onChange={setPanel} />

      <div className="pt-3">
        {shownPanel === "trades" ? (
          <TradesPanel
            trades={trades.trades}
            symbol={symbol}
            isLoading={trades.isLoading}
            error={trades.error}
            liveDown={trades.liveDown}
            onRetry={trades.retry}
          />
        ) : shownPanel === "comments" ? (
          <CommentsPanel
            kind={asset.kind}
            assetId={asset.id}
            symbol={symbol}
            imageUrl={tokenArt?.imageUrl ?? null}
            focusCommentId={commentTarget}
          />
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
    </>
  );

  if (desktop) {
    // Chart and conversation in the middle, trading on the right. Both panes
    // scroll on their own, so reading back through the tape never scrolls the
    // ticket out of reach.
    return (
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-2.5 p-2.5">
        <section className="scroll-quiet min-h-0 min-w-0 overflow-y-auto rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base px-[22px] pb-6 pt-4">
          {content}
        </section>
        <aside
          aria-label={`Trade ${symbol}`}
          className="scroll-quiet flex min-h-0 flex-col gap-2.5 overflow-y-auto"
        >
          <div className="rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base p-5">
            <OrderTicket asset={tradeAsset} side="buy" inline />
          </div>
          {asset.kind === "token" ? (
            <div className="rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base px-[22px] py-4">
              <InfoPanel token={asset} />
            </div>
          ) : (
            <NewsCard items={news.items} isLoading={news.isLoading} error={news.error} onRetry={news.retry} />
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className={cn(APP_SCROLL_PAD_TOP, "pb-[calc(84px+env(safe-area-inset-bottom))]")}>
      <BackButton onClick={() => router.back()} />

      {content}

      <TradeBar
        symbol={symbol}
        onBuy={() => setOrderSide("buy")}
        onSell={() => setOrderSide("sell")}
      />

      <OrderModal
        asset={orderSide ? tradeAsset : null}
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

/**
 * A chart-shaped placeholder: a faint line that pulses, the same height as the
 * chart it stands in for, so nothing below it moves when the data lands.
 */
function ChartSkeleton({height}: {height: number | string}) {
  return (
    <div
      aria-label="Loading chart"
      role="status"
      style={{height}}
      className="relative mt-3 w-full animate-pulse overflow-hidden rounded-xl bg-wash"
    >
      <svg
        viewBox="0 0 300 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-x-0 bottom-[18%] h-[55%] w-full text-[var(--overlay-wash-hover)]"
      >
        <polyline
          points="0,70 30,62 55,68 85,45 110,52 140,30 170,41 200,26 230,38 260,20 300,28"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
