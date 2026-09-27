"use client";

import {Suspense, useEffect, useMemo, useState} from "react";
import {usePathname, useRouter, useSearchParams} from "next/navigation";
import {AssetList} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {
  FeedFilterButton,
  NO_FILTERS,
  passesFilters,
  type FeedFilterState,
} from "@/components/FeedFilters";
import {StickyPageHeader} from "@/components/AppShell";
import {HomeTabs, type HomeTab} from "@/components/HomeTabs";
import {RocketIcon, StarIcon} from "@/components/ui/Icons";
import {useMarket} from "@/hooks/useMarket";
import {useNewTokens} from "@/hooks/useNewTokens";
import {useTheme} from "@/hooks/useTheme";
import {useWatchlistAssets} from "@/hooks/useWatchlist";
import {
  homeQuery,
  parseHomeView,
  rememberHomeView,
  type RwaSort,
  type TokenSort,
  type WatchFilter,
} from "@/lib/homeState";
import {SECTORS, type SectorId} from "@/lib/sectors";

/**
 * Deferred like the order ticket: the launch form pulls in the whole write
 * path, and most visits to Home never open it.
 */
const CreateSheet = dynamic(
  () => import("@/components/CreateSheet").then((m) => ({default: m.CreateSheet})),
  {ssr: false},
);
import dynamic from "next/dynamic";
import Image from "next/image";
import {APP_NAME} from "@/config/app";
import type {Asset} from "@/lib/types";
import {compareTrendingMomentum} from "@/lib/trendingScore";

const TOKEN_SORTS: FilterOption<TokenSort>[] = [
  {value: "trending", label: "Trending"},
  {
    value: "new",
    label: "New",
    title: "Newest migrations — RWA-paired tokens and rewarded quote pairs",
  },
  {value: "marketCap", label: "Market cap"},
  {
    value: "rewards",
    label: "Rewards",
    title: "Tokens with indexed 24h RWA holder payouts",
  },
];

const RWA_SORTS: FilterOption<RwaSort>[] = [
  {value: "marketCap", label: "Market cap"},
  {value: "movers", label: "Movers", title: "Largest move in either direction"},
];

const WATCH_FILTERS: FilterOption<WatchFilter>[] = [
  {value: "all", label: "All"},
  {value: "token", label: "Tokens"},
  {value: "rwa", label: "RWAs"},
];

export default function HomePage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <HomeFeed />
    </Suspense>
  );
}

function HomeFeed() {
  const {theme} = useTheme();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initial = parseHomeView(searchParams);

  const [tab, setTab] = useState<HomeTab>(initial.tab);
  // `/create` redirects here with `?create=1`, so a link to the launch form
  // keeps working even though it is a pop-up rather than a page.
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("create") === "1");

  // Drop the flag once it has been read, so closing the sheet and reloading
  // does not reopen it, and a shared link is the feed rather than the form.
  useEffect(() => {
    if (searchParams.get("create")) router.replace(pathname, {scroll: false});
  }, [pathname, router, searchParams]);
  const [tokenSort, setTokenSort] = useState<TokenSort>(initial.tokenSort);
  const [rwaSort, setRwaSort] = useState<RwaSort>(initial.rwaSort);
  const [sector, setSector] = useState<SectorId | "all">(initial.sector);
  const [watchFilter, setWatchFilter] = useState<WatchFilter>(initial.watchFilter);
  const [filters, setFilters] = useState<FeedFilterState>({
    ...NO_FILTERS,
    minMarketCap: initial.minMcap ?? null,
    maxMarketCap: initial.maxMcap ?? null,
    minLiquidity: initial.minLiq ?? null,
    maxLiquidity: initial.maxLiq ?? null,
    minVolume: initial.minVol ?? null,
    maxVolume: initial.maxVol ?? null,
    minAgeHours: initial.minAge ?? null,
    maxAgeHours: initial.maxAge ?? null,
  });

  useEffect(() => {
    const state = {
      tab,
      tokenSort,
      rwaSort,
      sector,
      watchFilter,
      minMcap: filters.minMarketCap,
      maxMcap: filters.maxMarketCap,
      minLiq: filters.minLiquidity,
      maxLiq: filters.maxLiquidity,
      minVol: filters.minVolume,
      maxVol: filters.maxVolume,
      minAge: filters.minAgeHours,
      maxAge: filters.maxAgeHours,
    };
    rememberHomeView(state);
    const query = homeQuery(state);
    const next = query.startsWith("?") ? query.slice(1) : "";
    if (searchParams.toString() !== next) {
      router.replace(`${pathname}${query}`, {scroll: false});
    }
  }, [tab, tokenSort, rwaSort, sector, watchFilter, filters.minMarketCap, filters.maxMarketCap, filters.minLiquidity, filters.maxLiquidity, filters.minVolume, filters.maxVolume, filters.minAgeHours, filters.maxAgeHours, pathname, router, searchParams]);

  const market = useMarket(
    tokenSort === "marketCap"
      ? "marketCap"
      : tokenSort === "rewards"
        ? "rewards"
        : "trending",
    {
    minLiq: filters.minLiquidity ?? initial.minLiq,
    maxLiq: filters.maxLiquidity ?? initial.maxLiq,
    minMcap: filters.minMarketCap ?? initial.minMcap,
    maxMcap: filters.maxMarketCap ?? initial.maxMcap,
    minVol: filters.minVolume ?? initial.minVol,
    maxVol: filters.maxVolume ?? initial.maxVol,
    minAge: filters.minAgeHours ?? initial.minAge,
    maxAge: filters.maxAgeHours ?? initial.maxAge,
  });
  const watchlist = useWatchlistAssets(tab === "watchlist");
  const newFilters = useMemo(
    () => ({
      launchpad: initial.launchpad,
      quote: initial.quote,
      rewards: initial.rewards,
      minMcap: filters.minMarketCap ?? initial.minMcap,
      maxMcap: filters.maxMarketCap ?? initial.maxMcap,
      minLiq: filters.minLiquidity ?? initial.minLiq,
      maxLiq: filters.maxLiquidity ?? initial.maxLiq,
      minVol: filters.minVolume ?? initial.minVol,
      maxVol: filters.maxVolume ?? initial.maxVol,
      minAge: filters.minAgeHours ?? initial.minAge,
      maxAge: filters.maxAgeHours ?? initial.maxAge,
    }),
    [
      initial.launchpad,
      initial.quote,
      initial.rewards,
      initial.minMcap,
      initial.maxMcap,
      initial.minLiq,
      initial.maxLiq,
      initial.minVol,
      initial.maxVol,
      initial.minAge,
      initial.maxAge,
      filters.minMarketCap,
      filters.maxMarketCap,
      filters.minLiquidity,
      filters.maxLiquidity,
      filters.minVolume,
      filters.maxVolume,
      filters.minAgeHours,
      filters.maxAgeHours,
    ],
  );
  const newFeed = useNewTokens(newFilters, tab === "tokens");

  const sectorOptions: FilterOption<SectorId | "all">[] = useMemo(() => {
    const counts = new Map<SectorId, number>();
    for (const asset of market.rwas) {
      counts.set(asset.sector, (counts.get(asset.sector) ?? 0) + 1);
    }
    return [
      {value: "all", label: "All", hint: String(market.rwas.length)},
      ...SECTORS.map((entry) => ({
        value: entry.id,
        label: entry.label,
        title: entry.description,
        hint: String(counts.get(entry.id) ?? 0),
        disabled: (counts.get(entry.id) ?? 0) === 0,
      })),
    ];
  }, [market.rwas]);

  const tokens = useMemo(() => {
    if (tokenSort === "new") {
      return newFeed.tokens.filter((token) => passesFilters(token, filters));
    }
    const list = market.tokens.filter((token) => passesFilters(token, filters));

    switch (tokenSort) {
      case "marketCap":
        return list.sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
      case "rewards":
        return list
          .filter((token) => token.rewards24hUsd > 0)
          .sort((a, b) => b.rewards24hUsd - a.rewards24hUsd);
      case "trending":
        return list.sort(compareTrendingMomentum);
      default:
        return list.sort(
          (a, b) =>
            b.windows[filters.window].volumeUsd -
            a.windows[filters.window].volumeUsd,
        );
    }
  }, [market.tokens, tokenSort, filters, newFeed.tokens]);

  const rwas = useMemo(() => {
    const list =
      sector === "all"
        ? [...market.rwas]
        : market.rwas.filter((asset) => asset.sector === sector);
    // Movers ranks by the size of the move, not its direction — a stock down
    // nine percent is as much of a mover as one up nine.
    return rwaSort === "movers"
      ? list.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      : list.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  }, [market.rwas, sector, rwaSort]);

  const watched = useMemo(
    () =>
      watchlist.assets.filter(
        (asset) => watchFilter === "all" || asset.kind === watchFilter,
      ),
    [watchlist.assets, watchFilter],
  );

  const showing: Asset[] =
    tab === "tokens" ? tokens : tab === "rwas" ? rwas : watched;

  const loading =
    tab === "watchlist"
      ? watchlist.isLoading
      : tokenSort === "new" && tab === "tokens"
        ? newFeed.isLoading
        : market.isLoading;

  return (
    <div>
      <StickyPageHeader>
        <div className="mb-4 flex items-center justify-between">
          <Image
            src={theme === "light" ? "/brand/logo.svg" : "/brand/logo-white-text.svg"}
            alt={APP_NAME}
            width={112}
            height={32}
            priority
            className="h-8 w-auto"
          />

          {/*
            Launching is the one thing a person comes here to *do* rather than
            read, so it gets the only filled brand control on the screen.
          */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-brand-500 px-3.5 text-[12.5px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
          >
            <RocketIcon className="h-[15px] w-[15px]" />
            Create
          </button>
        </div>

        <HomeTabs value={tab} onChange={setTab} />

        <div className="py-3.5">
          {tab === "tokens" ? (
            <FilterRail
              label="Sort tokens"
              options={TOKEN_SORTS}
              value={tokenSort}
              onChange={setTokenSort}
              lead={
                <FeedFilterButton state={filters} onChange={setFilters} />
              }
            />
          ) : tab === "rwas" ? (
            <div className="flex flex-col gap-2.5">
              <FilterRail
                label="Filter by sector"
                options={sectorOptions}
                value={sector}
                onChange={setSector}
              />
              <FilterRail
                label="Sort real-world assets"
                options={RWA_SORTS}
                value={rwaSort}
                onChange={setRwaSort}
              />
            </div>
          ) : (
            <FilterRail
              label="Filter watchlist"
              options={WATCH_FILTERS}
              value={watchFilter}
              onChange={setWatchFilter}
            />
          )}
        </div>
      </StickyPageHeader>

      {showing.length > 0 ? (
        <>
          <AssetList
            assets={showing}
            markArrivals={tab === "tokens" && tokenSort === "new"}
            chartTimeframe={
              tab === "tokens" && tokenSort === "new" ? "1m" : undefined
            }
          />
          {tab === "tokens" && tokenSort === "new" && newFeed.hasMore ? (
            <button
              type="button"
              onClick={newFeed.loadMore}
              className="mt-3 w-full py-3 text-[13px] font-bold text-muted"
            >
              Load more
            </button>
          ) : null}
        </>
      ) : loading ? (
        <FeedSkeleton />
      ) : tab === "tokens" && tokenSort === "new" && newFeed.error ? (
        <p className="py-8 text-center text-[13.5px] text-muted">
          Could not load new tokens. Retrying.
        </p>
      ) : market.error && !(tab === "tokens" && tokenSort === "new") ? (
        <p className="py-8 text-center text-[13.5px] text-muted">
          Could not load the market. Retrying.
        </p>
      ) : (
        <EmptyFeed
          tab={tab}
          watching={watchlist.count > 0}
          reason={tab === "tokens" ? tokenSort : undefined}
        />
      )}

      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function EmptyFeed({
  tab,
  watching,
  reason,
}: {
  tab: HomeTab;
  watching: boolean;
  reason?: string;
}) {
  if (tab === "watchlist" && !watching) {
    return (
      <div className="px-6 py-12 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
          <StarIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 text-[14px] font-bold">Nothing watched yet</p>
        <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-[1.5] text-muted">
          Tap the star on any ticker or token to keep it here.
        </p>
      </div>
    );
  }

  if (reason === "rewards") {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-[14px] font-bold">No 24h RWA payouts yet</p>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-[1.5] text-muted">
          The indexer has not recorded a holder payout in the last day.
        </p>
      </div>
    );
  }

  if (reason === "new") {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-[14px] font-bold">No new graduations yet</p>
        <p className="mx-auto mt-1.5 max-w-[36ch] text-[13px] leading-[1.5] text-muted">
          This lists Pons and Long tokens that have fully bonded onto Uniswap
          and are worth over $50k. Check back as launches graduate.
        </p>
      </div>
    );
  }

  return (
    <p className="py-10 text-center text-[13.5px] text-muted">
      Nothing to show here right now.
    </p>
  );
}

function FeedSkeleton() {
  return (
    <div className="-mx-[22px] divide-y divide-hairline">
      {Array.from({length: 8}).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-[22px] py-[15px]">
          <div className="h-10 w-10 animate-pulse rounded-full bg-wash" />
          <div className="flex-1">
            <div className="h-3.5 w-20 animate-pulse rounded bg-wash" />
            <div className="mt-2 h-3 w-14 animate-pulse rounded bg-wash" />
          </div>
          <div className="h-7 w-[52px] animate-pulse rounded bg-wash" />
          <div className="h-8 w-16 animate-pulse rounded bg-wash" />
        </div>
      ))}
    </div>
  );
}
