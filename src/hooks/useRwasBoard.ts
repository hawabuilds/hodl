"use client";

import {useMemo} from "react";
import {keepPreviousData, useInfiniteQuery, useQuery} from "@tanstack/react-query";

import {useWatchlist} from "@/hooks/useWatchlist";
import type {RwaBoardPage, RwaCategory, RwaSort, RwasOverview} from "@/lib/rwaBoard";

/** Stock prices move every second in the session; the list follows each minute. */
const LIST_REFRESH_MS = 60_000;
const OVERVIEW_REFRESH_MS = 30_000;

export const RWAS_OVERVIEW_KEY = ["rwas-overview"] as const;

export async function fetchRwasOverview(): Promise<RwasOverview> {
  const res = await fetch("/api/rwas/overview");
  if (!res.ok) throw new Error("Couldn't load the overview.");
  return (await res.json()) as RwasOverview;
}

/** All stocks, one page: a GET the edge can serve. */
export async function fetchAllRwasPage(
  category: RwaCategory | "all",
  sort: RwaSort,
  offset: number,
  signal?: AbortSignal,
): Promise<RwaBoardPage> {
  const params = new URLSearchParams({category, sort, offset: String(offset)});
  const res = await fetch(`/api/rwas/list?${params}`, {signal});
  if (!res.ok) throw new Error("Couldn't load stocks.");
  return (await res.json()) as RwaBoardPage;
}

/** The cache key `useRwasList` uses for the All tab. */
export function allRwasKey(category: RwaCategory | "all", sort: RwaSort) {
  return ["rwas-list", "all", category, sort, ""] as const;
}

/** Movers, Robinhood's posts, the latest news, and every stock's price and move. */
export function useRwasOverview() {
  return useQuery({
    queryKey: RWAS_OVERVIEW_KEY,
    refetchInterval: OVERVIEW_REFRESH_MS,
    staleTime: 15_000,
    queryFn: fetchRwasOverview,
  });
}

/** The tickers on the shared watchlist — the RWAs tab shows only its stocks. */
export function useWatchedStocks(): string[] {
  const {keys} = useWatchlist();
  return useMemo(
    () =>
      keys
        .filter((key) => key.startsWith("rwa:"))
        .map((key) => key.slice("rwa:".length).toUpperCase())
        .sort(),
    [keys],
  );
}

/** The side list: pages of 50, sorted and filtered on the server, loaded as it scrolls. */
export function useRwasList(input: {tab: "all" | "watchlist"; category: RwaCategory | "all"; sort: RwaSort}) {
  const watch = useWatchedStocks();
  const noWatch = input.tab === "watchlist" && watch.length === 0;

  const query = useInfiniteQuery({
    queryKey: ["rwas-list", input.tab, input.category, input.sort, input.tab === "watchlist" ? watch.join(",") : ""],
    initialPageParam: 0,
    getNextPageParam: (last: RwaBoardPage) => last.next,
    refetchInterval: LIST_REFRESH_MS,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    enabled: !noWatch,
    queryFn: async ({pageParam, signal}): Promise<RwaBoardPage> => {
      // All stocks are the same for everyone: a GET the edge can serve.
      if (input.tab === "all") return fetchAllRwasPage(input.category, input.sort, pageParam, signal);
      const res = await fetch("/api/rwas/list", {
        method: "POST",
        headers: {"content-type": "application/json"},
        signal,
        body: JSON.stringify({
          tab: input.tab,
          category: input.category,
          sort: input.sort,
          offset: pageParam,
          watch: input.tab === "watchlist" ? watch : undefined,
        }),
      });
      if (!res.ok) throw new Error("Couldn't load stocks.");
      return (await res.json()) as RwaBoardPage;
    },
  });

  // Stable between renders, so nothing downstream re-renders on its own.
  const rows = useMemo(
    () => (noWatch ? [] : (query.data?.pages ?? []).flatMap((page) => page.rows)),
    [noWatch, query.data],
  );
  const first = query.data?.pages[0];

  return {
    rows,
    counts: noWatch ? null : (first?.counts ?? null),
    total: noWatch ? 0 : (first?.total ?? 0),
    session: first?.session ?? null,
    isLoading: query.isPending && !noWatch,
    isSwitching: query.isPlaceholderData,
    error: query.error,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    retry: () => void query.refetch(),
    watchCount: watch.length,
  };
}
