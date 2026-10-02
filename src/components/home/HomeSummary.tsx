"use client";

import {useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {usePathname, useRouter, useSearchParams} from "next/navigation";
import {useQuery} from "@tanstack/react-query";

import {AssetLink} from "@/components/AssetLink";
import {AssetList} from "@/components/AssetRow";
import {PillRail} from "@/components/PillRail";
import {PriceChart} from "@/components/PriceChart";
import {Avatar} from "@/components/ui/Avatar";
import {NewsImage} from "@/components/ui/NewsImage";
import {VerifiedTick} from "@/components/ui/Badges";
import {PriceDelta} from "@/components/ui/PriceDelta";
import {useChart} from "@/hooks/useAsset";
import {useHomeBundle} from "@/hooks/useHomeBundle";
import {useHomeFeatured} from "@/hooks/useHomeFeatured";
import {useMarket} from "@/hooks/useMarket";
import {useNewsFeed} from "@/hooks/useNewsFeed";
import {useNewTokens} from "@/hooks/useNewTokens";
import {useUser} from "@/hooks/useUser";
import {useFollows} from "@/hooks/useProfile";
import {chartWindowMs} from "@/lib/chartPlot";
import {cn} from "@/lib/cn";
import {requestCreate} from "@/lib/createIntent";
import {sortRwas, sortTokens} from "@/lib/feedSorts";
import {rememberHomePath} from "@/lib/homeState";
import {
  FEATURED_RANGES,
  RANGE_SOURCE,
  newsForTickers,
  sliceToRange,
  type FeaturedRange,
} from "@/lib/homeSummary";
import {NEWS_DEFAULT_TOPIC, NEWS_DEFAULT_WINDOW} from "@/lib/newsWindow";
import {formatPriceUsd} from "@/lib/priceState";
import {newsArticlePath, profilePath} from "@/lib/routes";
import {sectorFor} from "@/lib/sectors";
import {useSession} from "@/lib/session";
import type {FollowingComment, RwaAsset} from "@/lib/types";
import type {SuggestedTrader} from "@/lib/server/suggestedTraders";
import {
  CardBoundary,
  CardError,
  CardNote,
  RowsSkeleton,
  SeeAll,
  SummaryCard,
} from "./SummaryCard";

/** Stable, so the new-token feed is not re-keyed every render. */
const ALL_LAUNCHES = {};

/** Rows in each list card. */
const ROWS = 4;

/**
 * Home's sizes, as CSS variables set once on the page: roomy cards (24px
 * between and inside them), 62px rows with a 5px gap between a row's two
 * lines, and the page scrolls when the window is short rather than shrinking.
 */
// Written out whole: Tailwind only generates classes it can read in the
// source, so a variant spliced in with `${...}` never reaches the CSS.
const SIZES = [
  "[--home-gap:24px] [--home-pad:24px] [--home-stack:10px]",
  "[--home-card-pt:22px] [--home-card-px:24px] [--home-card-pb:14px]",
  "[--home-row:62px] [--home-logo:36px] [--home-chart:180px] [--home-line-gap:5px]",
  "[--home-t-title:16px] [--home-t-body:15px] [--home-t-small:12.5px]",
  "[--home-t-name:20px] [--home-t-price:34px] [--home-feat-logo:40px]",
  "[--home-open:42px] [--home-news-row:64px] [--home-thumb-w:64px] [--home-thumb-h:44px]",
].join(" ");

const smallText = "text-[length:var(--home-t-small)] leading-[1.25]";
const bodyText = "text-[length:var(--home-t-body)] leading-[1.25]";

/**
 * The card rows by width. Desktop Home starts at 1024px (a phone gets the
 * feed): 2 cards a row up to 1280px, 3 from there. With three cards in two
 * columns the third takes the whole second row rather than leaving a hole.
 */
const THREE_UP = "grid gap-[var(--home-gap)] lg:grid-cols-2 xl:grid-cols-3";
const THIRD_OF_THREE = "min-w-0 lg:col-span-2 xl:col-span-1";
const TWO_UP = "grid gap-[var(--home-gap)] lg:grid-cols-2 xl:grid-cols-12";
const WIDE_OF_TWO = "min-w-0 xl:col-span-7";
const NARROW_OF_TWO = "min-w-0 xl:col-span-5";

/**
 * Home: a calm summary of the market, for someone arriving from Robinhood.
 *
 * Laid out as its design: the featured RWA beside its paired tokens; then
 * trending, just launched and RWAs on the move; then news beside people you
 * follow. The dense lists live on Tokens and RWAs; every card links there.
 * Each card fetches, loads, empties and fails on its own.
 *
 * Desktop only: a phone's Home is the feed, as it was before the desktop site.
 */
export function HomeSummary() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Back from a chart page returns here, not to a list.
  useEffect(() => rememberHomePath("/home"), []);

  // One request for every public card, and the personal one started beside
  // it; the page shows once both are in (or after 1.5s, whichever is first),
  // so the cards appear together instead of one by one.
  const bundleReady = useHomeBundle();
  const following = useFollowingComments();
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), 1_500);
    return () => window.clearTimeout(timer);
  }, []);
  const ready = bundleReady && (!following.isLoading || waited);

  // `/create` lands here with `?create=1`; the desktop shell owns the sheet.
  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    requestCreate();
    router.replace(pathname, {scroll: false});
  }, [pathname, router, searchParams]);

  return (
    <div
      className={cn(
        SIZES,
        "mx-auto flex w-full max-w-[1600px] flex-col gap-[var(--home-gap)] p-[var(--home-gap)]",
      )}
    >
      {ready ? null : <HomeSkeleton />}
      {ready ? (
      <>
      <CardBoundary title="Most token volume today">
        <FeaturedRwaCard />
      </CardBoundary>

      <div className={THREE_UP}>
        <CardBoundary title="Trending tokens" className="h-full">
          <TrendingCard />
        </CardBoundary>
        <CardBoundary title="Just launched" className="h-full">
          <JustLaunchedCard />
        </CardBoundary>
        {/* Alone on its row at 1024–1279px, so its rows sit two by two there. */}
        <div className={cn(THIRD_OF_THREE, "lg:[&_ul]:grid lg:[&_ul]:grid-cols-2 lg:[&_ul]:gap-x-6 xl:[&_ul]:block")}>
          <CardBoundary title="RWAs on the move" className="h-full">
            <MoversCard />
          </CardBoundary>
        </div>
      </div>

      <div className={TWO_UP}>
        <div className={WIDE_OF_TWO}>
          <CardBoundary title="News on the RWAs behind the tokens" className="h-full">
            <NewsCard />
          </CardBoundary>
        </div>
        {/* Not stretched to the news card's height: with nobody followed it
            is a short card, not a tall empty box. */}
        <div className={cn(NARROW_OF_TWO, "self-start")}>
          <CardBoundary title="From people you follow">
            <FollowingCard />
          </CardBoundary>
        </div>
      </div>
      </>
      ) : null}
    </div>
  );
}

/** The whole page as one skeleton: the same grid and card shells as the real page. */
function HomeSkeleton() {
  return (
    <>
      <FeaturedSkeleton />
      <div className={THREE_UP}>
        {["Trending tokens", "Just launched", "RWAs on the move"].map((title, i) => (
          <SummaryCard key={title} title={title} className={cn("h-full", i === 2 && THIRD_OF_THREE)}>
            <RowsSkeleton count={ROWS} />
          </SummaryCard>
        ))}
      </div>
      <div className={TWO_UP}>
        <div className={WIDE_OF_TWO}>
          <SummaryCard title="News on the RWAs behind the tokens" className="h-full">
            <RowsSkeleton count={3} />
          </SummaryCard>
        </div>
        <div className={cn(NARROW_OF_TWO, "self-start")}>
          <SummaryCard title="From people you follow">
            <RowsSkeleton count={3} />
          </SummaryCard>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ featured */

function FeaturedRwaCard() {
  // Which RWA leads is decided on the server from every listed token's 24h
  // volume (server/homeFeatured.ts); the market list supplies its quote.
  const featured = useHomeFeatured();
  const market = useMarket("trending");
  const lead = useMemo(() => {
    const ticker = featured.data?.ticker;
    const rwa = ticker ? market.rwas.find((asset) => asset.ticker === ticker) : undefined;
    return rwa ? {rwa, paired: featured.data?.paired ?? []} : null;
  }, [featured.data, market.rwas]);

  if (featured.isLoading || (market.isLoading && !lead)) return <FeaturedSkeleton />;
  if (!lead) {
    return (
      <SummaryCard title="Most token volume today">
        {featured.error ? (
          <CardError />
        ) : (
          <CardNote>No RWA-paired token has traded today yet.</CardNote>
        )}
      </SummaryCard>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--overlay-wash)] bg-surface-base lg:grid lg:grid-cols-12">
      <FeaturedChart rwa={lead.rwa} />
      <div className="flex min-w-0 flex-col border-t border-[var(--overlay-wash)] p-[var(--home-pad)] lg:col-span-6 xl:col-span-5 lg:border-l lg:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="line-clamp-2 min-w-0 text-[length:var(--home-t-title)] font-extrabold leading-[1.25] tracking-[-0.02em]">
            Tokens paired with {lead.rwa.ticker}
          </h2>
          <SeeAll href="/tokens">See all</SeeAll>
        </div>
        <p className={cn("mb-1 mt-0.5 truncate font-semibold text-faint", smallText)}>
          Tokens trading against {lead.rwa.name}
        </p>
        <div className="-mx-3.5">
          <AssetList assets={lead.paired} flush dense compact pairChip={false} wideChart />
        </div>
        <div className="min-h-[var(--home-stack)] flex-1" />
        <AssetLink
          kind="rwa"
          id={lead.rwa.id}
          className={cn(
            "flex h-[var(--home-open)] items-center justify-center rounded-xl bg-[var(--bg-input)] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]",
            bodyText,
          )}
        >
          Open {lead.rwa.ticker}
        </AssetLink>
      </div>
    </section>
  );
}

function FeaturedChart({rwa}: {rwa: RwaAsset}) {
  const [range, setRange] = useState<FeaturedRange>("1D");
  const source = RANGE_SOURCE[range];
  const chart = useChart("rwa", rwa.id, source.timeframe);
  const points = useMemo(
    () => sliceToRange(chart.points, source.spanMs),
    [chart.points, source.spanMs],
  );
  const positive = rwa.changePct >= 0;
  const sector = sectorFor(rwa.ticker);

  return (
    <div className="flex min-w-0 flex-col gap-[var(--home-stack)] p-[var(--home-pad)] lg:col-span-6 xl:col-span-7">
      <div className={cn("font-bold uppercase tracking-[0.09em] text-faint", smallText)}>
        Most token volume today
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {/* The company logo, as on the RWAs tab; the coloured lettered avatar without one. */}
        <Avatar
          className="!h-[var(--home-feat-logo)] !w-[var(--home-feat-logo)]"
          name={rwa.ticker}
          src={rwa.logoUrl}
          seed={rwa.ticker}
          size={36}
          eager
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[length:var(--home-t-name)] font-extrabold leading-[1.2] tracking-[-0.03em]">
              {rwa.name}
            </h2>
            <VerifiedTick size={15} />
          </div>
          <div className={cn("truncate font-semibold text-faint", smallText)}>
            {rwa.ticker}
            {sector ? ` · ${sector.label}` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular-nums text-[length:var(--home-t-price)] font-extrabold leading-none tracking-[-0.035em]">
          {formatPriceUsd(rwa.priceUsd)}
        </span>
        <span className={cn("font-bold", bodyText)}>
          <PriceDelta value={rwa.changePct} />
          <span className="ml-1.5 font-semibold text-faint">today</span>
        </span>
      </div>

      <div className="relative">
        {chart.isLoading ? (
          <div className="h-[var(--home-chart)] animate-pulse rounded-xl bg-[var(--overlay-wash)]" />
        ) : chart.error && points.length < 2 ? (
          <div className="flex h-[var(--home-chart)] items-center justify-center rounded-xl bg-[var(--overlay-wash)]">
            <CardError onRetry={chart.retry} />
          </div>
        ) : (
          <PriceChart
            points={points}
            positive={positive}
            windowMs={chartWindowMs(source.timeframe)}
            emptyLabel="Not enough history for this range"
            height="var(--home-chart)"
          />
        )}
      </div>

      <div className="[@media(min-width:1024px)_and_(max-height:879.98px)]:[&_button]:py-1 [@media(min-width:1024px)_and_(max-height:879.98px)]:[&_button]:text-[12px]">
        <PillRail
          label="Chart range"
          options={FEATURED_RANGES}
          value={range}
          onChange={setRange}
          positive={positive}
        />
      </div>
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border border-[var(--overlay-wash)] bg-surface-base lg:grid lg:grid-cols-12"
    >
      <div className="flex flex-col gap-[var(--home-stack)] p-[var(--home-pad)] lg:col-span-6 xl:col-span-7">
        <span className="h-3 w-40 animate-pulse rounded bg-[var(--overlay-wash)]" />
        <span className="h-9 w-56 animate-pulse rounded bg-[var(--overlay-wash)]" />
        <span className="h-8 w-36 animate-pulse rounded bg-[var(--overlay-wash)]" />
        <span className="h-[var(--home-chart)] animate-pulse rounded-xl bg-[var(--overlay-wash)]" />
        <span className="h-7 w-48 animate-pulse rounded bg-[var(--overlay-wash)]" />
      </div>
      <div className="border-t border-[var(--overlay-wash)] p-[var(--home-pad)] lg:col-span-6 xl:col-span-5 lg:border-l lg:border-t-0">
        <span className="block h-5 w-48 animate-pulse rounded bg-[var(--overlay-wash)]" />
        <RowsSkeleton count={4} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ lists */

function TrendingCard() {
  // The same query and order as the Trending column on Tokens.
  const market = useMarket("trending");
  const tokens = useMemo(
    () => sortTokens(market.tokens, "trending").slice(0, ROWS),
    [market.tokens],
  );
  return (
    <SummaryCard title="Trending tokens" action={<SeeAll href="/tokens">See all</SeeAll>} className="h-full">
      <ListBody
        loading={market.isLoading}
        failed={Boolean(market.error) && tokens.length === 0}
        empty="Nothing is trending right now."
      >
        <AssetList assets={tokens} flush dense compact sparkline={false} />
      </ListBody>
    </SummaryCard>
  );
}

function JustLaunchedCard() {
  const launches = useNewTokens(ALL_LAUNCHES, true);
  const tokens = launches.tokens.slice(0, ROWS);
  return (
    <SummaryCard
      title="Just launched"
      action={<SeeAll href="/tokens?sort=new">See all</SeeAll>}
      className="h-full"
    >
      <ListBody
        loading={launches.isLoading}
        failed={Boolean(launches.error) && tokens.length === 0}
        empty="Nothing has launched yet today."
      >
        <AssetList assets={tokens} flush dense compact sparkline={false} chartTimeframe="1m" />
      </ListBody>
    </SummaryCard>
  );
}

function MoversCard() {
  const market = useMarket("trending");
  const rwas = useMemo(() => sortRwas(market.rwas, "movers").slice(0, ROWS), [market.rwas]);
  return (
    <SummaryCard
      title="RWAs on the move"
      action={<SeeAll href="/rwas?rwaSort=movers">See all</SeeAll>}
      className="h-full"
    >
      <ListBody
        loading={market.isLoading}
        failed={Boolean(market.error) && rwas.length === 0}
        empty="No RWA prices yet."
      >
        <AssetList assets={rwas} flush dense compact sparkline={false} />
      </ListBody>
    </SummaryCard>
  );
}

function ListBody({
  loading,
  failed,
  empty,
  children,
}: {
  loading: boolean;
  failed: boolean;
  empty: string;
  children: React.ReactElement<{assets: unknown[]}>;
}) {
  if (loading) {
    return (
      <RowsSkeleton count={ROWS} />
    );
  }
  if (failed) return <CardError />;
  if (children.props.assets.length === 0) return <CardNote>{empty}</CardNote>;
  return <div className="-mx-3.5">{children}</div>;
}

/* ------------------------------------------------------------ news */

function NewsCard() {
  const feed = useNewsFeed(NEWS_DEFAULT_WINDOW, NEWS_DEFAULT_TOPIC);
  const market = useMarket("trending");
  const names = useMemo(
    () => new Map(market.rwas.map((rwa) => [rwa.ticker, rwa.name])),
    [market.rwas],
  );
  const items = useMemo(() => {
    const behind = new Set(
      sortTokens(market.tokens, "trending")
        .slice(0, 10)
        .map((token) => token.pairedTicker),
    );
    return newsForTickers(feed.data?.items ?? [], behind, 3);
  }, [feed.data?.items, market.tokens]);

  return (
    <SummaryCard
      title="News on the RWAs behind the tokens"
      action={<SeeAll href="/news">All news</SeeAll>}
      className="h-full"
    >
      {feed.isLoading ? (
        <RowsSkeleton count={3} />
      ) : feed.error && items.length === 0 ? (
        <CardError onRetry={() => void feed.refetch()} />
      ) : items.length === 0 ? (
        <CardNote>No stories about these RWAs yet.</CardNote>
      ) : (
        <ul className="-mx-2">
          {items.map((item) => {
            const ticker = item.tickers[0];
            const company = ticker ? (names.get(ticker) ?? ticker) : null;
            return (
              <li key={item.id}>
                <Link
                  href={newsArticlePath(item.id)}
                  className="flex h-[var(--home-news-row)] items-center gap-3 rounded-xl px-2 transition-colors hover:bg-[var(--overlay-wash)]"
                >
                  <Thumbnail src={item.imageUrl} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-semibold text-faint", smallText)}>
                      {item.source}
                      {company ? ` · ${company}` : ""}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block truncate font-bold tracking-[-0.015em]",
                        bodyText,
                      )}
                    >
                      {item.body}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SummaryCard>
  );
}

/** A story's picture in the design's box; a missing or broken one leaves the box. */
function Thumbnail({src}: {src: string | null | undefined}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="h-[var(--home-thumb-h)] w-[var(--home-thumb-w)] shrink-0 overflow-hidden rounded-[8px] bg-[var(--overlay-wash)]">
      {src && !failed ? (
        <NewsImage
          src={src}
          width={240}
          loading="lazy"
          onFail={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------ people */

function useFollowingComments() {
  const session = useSession();
  const user = useUser();
  // Follows are kept on the device in demo mode, so there is no one to ask.
  const enabled = user.authenticated && session.mode === "privy";
  const query = useQuery({
    queryKey: ["following-comments", user.user?.id ?? ""],
    enabled,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: 1,
    queryFn: async () => {
      const token = await session.getAccessToken();
      if (!token) return [] as FollowingComment[];
      const res = await fetch("/api/follows/comments", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!res.ok) throw new Error("Couldn't load comments.");
      const data = (await res.json()) as {comments?: FollowingComment[]};
      return data.comments ?? [];
    },
  });
  return {
    comments: query.data ?? [],
    isLoading: enabled && query.isPending,
    error: query.error,
    retry: () => void query.refetch(),
  };
}

function useSuggestedTraders(enabled: boolean) {
  return useQuery({
    queryKey: ["suggested-traders"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SuggestedTrader[]> => {
      const res = await fetch("/api/people/suggested");
      if (!res.ok) return [];
      return ((await res.json()) as {people?: SuggestedTrader[]}).people ?? [];
    },
  });
}

/** A short line rather than a tall empty box. */
function ShortNote({children}: {children: React.ReactNode}) {
  return <p className={cn("py-3 text-faint", smallText)}>{children}</p>;
}

function FollowingCard() {
  const following = useFollowingComments();
  const follows = useFollows();
  const me = useUser();
  const followsNobody = !follows.isLoading && follows.following.length === 0;
  const showSuggestions = !following.isLoading && following.comments.length === 0 && followsNobody;
  const suggested = useSuggestedTraders(showSuggestions);

  if (following.comments.length === 0 && !following.isLoading && !following.error) {
    if (showSuggestions) {
      const mine = me.handle?.toLowerCase();
      const people = (suggested.data ?? [])
        .filter((person) => person.handle.toLowerCase() !== mine && !follows.has(person.handle))
        .slice(0, 3);
      return (
        <SummaryCard title="People to follow" action={<SeeAll href="/profile">See all</SeeAll>}>
          <p className={cn("-mt-0.5 mb-1 font-semibold text-faint", smallText)}>Follow traders to see their trades here.</p>
          {suggested.isLoading ? (
            <RowsSkeleton count={3} />
          ) : people.length === 0 ? (
            <ShortNote>No active traders to suggest yet. Follow people from any comment to see them here.</ShortNote>
          ) : (
            <ul className="-mx-2">
              {people.map((person) => (
                <li key={person.handle} className="flex h-[var(--home-row)] items-center gap-3 px-2">
                  <Link href={profilePath(person.handle)} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar
                      name={person.displayName}
                      src={person.pfpUrl}
                      size={36}
                      className="!h-[var(--home-logo)] !w-[var(--home-logo)]"
                    />
                    <span className="min-w-0">
                      <span className={cn("block truncate font-extrabold", bodyText)}>@{person.handle}</span>
                      <span className={cn("mt-[var(--home-line-gap)] block truncate font-semibold text-faint", smallText)}>
                        {person.symbols.length > 0 ? `Trades ${person.symbols.join(", ")}` : `${person.trades} trades`}
                      </span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => follows.toggle(person.handle)}
                    className={cn(
                      "h-8 shrink-0 rounded-full bg-[var(--bg-input)] px-3.5 font-bold transition-colors hover:bg-[var(--overlay-wash-hover)]",
                      smallText,
                    )}
                  >
                    {follows.has(person.handle) ? "Following" : "Follow"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SummaryCard>
      );
    }
    return (
      <SummaryCard title="From people you follow" action={<SeeAll href="/profile">See all</SeeAll>}>
        <ShortNote>Nothing new from the people you follow yet.</ShortNote>
      </SummaryCard>
    );
  }

  return (
    <SummaryCard
      title="From people you follow"
      action={<SeeAll href="/profile">See all</SeeAll>}
      className="h-full"
    >
      {following.isLoading ? (
        <RowsSkeleton count={3} />
      ) : following.error ? (
        <CardError onRetry={following.retry} />
      ) : (
        <ul className="-mx-2">
          {following.comments.slice(0, 3).map((comment) => (
            <li key={comment.id}>
              <AssetLink
                kind={comment.asset.kind}
                id={comment.asset.id}
                className="flex h-[var(--home-news-row)] items-center gap-3 rounded-xl px-2 transition-colors hover:bg-[var(--overlay-wash)]"
              >
                <Avatar
                  name={comment.author.displayName}
                  src={comment.author.pfpUrl}
                  size={28}
                  className="!h-[var(--home-logo)] !w-[var(--home-logo)]"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", bodyText)}>
                    <span className="font-extrabold">@{comment.author.handle}</span>{" "}
                    <span className="font-semibold text-faint">
                      commented on {comment.asset.label}
                    </span>
                  </span>
                  <span className={cn("mt-[var(--home-line-gap)] block truncate text-muted", bodyText)}>
                    {comment.body}
                  </span>
                </span>
              </AssetLink>
            </li>
          ))}
        </ul>
      )}
    </SummaryCard>
  );
}
