"use client";

import {useMemo, useState} from "react";
import {AssetList} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HomeTabs, type HomeTab} from "@/components/HomeTabs";
import {StarIcon} from "@/components/ui/Icons";
import {useMarket} from "@/hooks/useMarket";
import {useWatchlistAssets} from "@/hooks/useWatchlist";
import {SECTORS, type SectorId} from "@/lib/sectors";
import {APP_NAME} from "@/config/app";
import type {Asset} from "@/lib/types";

type TokenSort = "new" | "trending" | "marketCap" | "rewards";
type RwaSort = "marketCap" | "movers";
type WatchFilter = "all" | "token" | "rwa";

const TOKEN_SORTS: FilterOption<TokenSort>[] = [
  {value: "trending", label: "Trending"},
  {value: "new", label: "New"},
  {value: "marketCap", label: "Market cap"},
  {value: "rewards", label: "Rewards", title: "Ranked by pool fees paid out over 24h"},
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
  const [tab, setTab] = useState<HomeTab>("tokens");
  const [tokenSort, setTokenSort] = useState<TokenSort>("trending");
  const [rwaSort, setRwaSort] = useState<RwaSort>("marketCap");
  const [sector, setSector] = useState<SectorId | "all">("all");
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("all");

  const market = useMarket();
  const watchlist = useWatchlistAssets(tab === "watchlist");

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
    const list = [...market.tokens];
    switch (tokenSort) {
      case "new":
        return list.sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        );
      case "marketCap":
        return list.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
      case "rewards":
        return list.sort((a, b) => b.rewards24hUsd - a.rewards24hUsd);
      default:
        return list.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
    }
  }, [market.tokens, tokenSort]);

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
    tab === "watchlist" ? watchlist.isLoading : market.isLoading;

  return (
    <div>
      <div className="mb-4 text-[21px] font-extrabold leading-none tracking-[-0.04em]">
        {APP_NAME}
      </div>

      <HomeTabs value={tab} onChange={setTab} />

      <div className="py-3.5">
        {tab === "tokens" ? (
          <FilterRail
            label="Sort tokens"
            options={TOKEN_SORTS}
            value={tokenSort}
            onChange={setTokenSort}
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

      {loading && showing.length === 0 ? (
        <FeedSkeleton />
      ) : market.error ? (
        <p className="py-8 text-center text-[13.5px] text-muted">
          {market.error.message}
        </p>
      ) : showing.length === 0 ? (
        <EmptyFeed tab={tab} watching={watchlist.count > 0} />
      ) : (
        <AssetList assets={showing} />
      )}

      {market.seeded && !market.isLoading ? (
        <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
          Seeded market data. Prices, pools and trades are simulated until the
          registry and pool indexer are connected.
        </p>
      ) : null}
    </div>
  );
}

function EmptyFeed({tab, watching}: {tab: HomeTab; watching: boolean}) {
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
