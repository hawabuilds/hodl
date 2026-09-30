"use client";

import {useMemo} from "react";
import {keepPreviousData, useInfiniteQuery} from "@tanstack/react-query";

import {useUser} from "@/hooks/useUser";
import {useWatchlist} from "@/hooks/useWatchlist";
import {useSession} from "@/lib/session";
import type {TokensCursor, TokensOrder, TokensPage, TokensTab} from "@/lib/tokensTable";

/** How often loaded rows refresh, like the other live lists. */
const REFRESH_MS = 20_000;

/**
 * The desktop Tokens table's rows: pages of 50, sorted on the server, loaded
 * as the list nears its end. Pages stay cached a while, so going into a token
 * and back finds the same rows already there.
 */
export function useTokensTable(input: {tab: TokensTab; order: TokensOrder; stock: string | null}) {
  const session = useSession();
  const user = useUser();
  const {keys} = useWatchlist();
  const watch = useMemo(
    () =>
      keys
        .filter((key) => key.startsWith("token:"))
        .map((key) => key.slice("token:".length))
        .sort(),
    [keys],
  );

  const query = useInfiniteQuery({
    queryKey: [
      "tokens-table",
      input.tab,
      input.order.sort,
      input.order.desc,
      input.stock ?? "",
      input.tab === "watchlist" ? watch.join(",") : "",
      input.tab === "following" ? (user.user?.id ?? "") : "",
    ],
    initialPageParam: null as TokensCursor | null,
    getNextPageParam: (last: TokensPage) => last.next,
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    enabled: input.tab !== "watchlist" || watch.length > 0,
    queryFn: async ({pageParam, signal}): Promise<TokensPage & {signedOut?: boolean}> => {
      const headers: Record<string, string> = {"content-type": "application/json"};
      if (input.tab === "following") {
        const token = await session.getAccessToken();
        if (token) headers.authorization = `Bearer ${token}`;
      }
      const res = await fetch("/api/tokens/table", {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          tab: input.tab,
          sort: input.order.sort,
          dir: input.order.desc ? "desc" : "asc",
          stock: input.stock,
          cursor: pageParam,
          watch: input.tab === "watchlist" ? watch : undefined,
        }),
      });
      if (!res.ok) throw new Error("Couldn't load tokens.");
      return (await res.json()) as TokensPage;
    },
  });

  // Stable between renders: the table keeps its own copy of these in state, so
  // a fresh array each render would re-render it forever.
  const noWatch = input.tab === "watchlist" && watch.length === 0;
  const rows = useMemo(
    () => (noWatch ? [] : (query.data?.pages ?? []).flatMap((page) => page.rows)),
    [noWatch, query.data],
  );
  const pairs = useMemo(() => query.data?.pages[0]?.pairs ?? [], [query.data]);
  return {
    rows,
    pairs,
    isLoading: query.isPending && (input.tab !== "watchlist" || watch.length > 0),
    /** Showing another view's rows while this one loads. */
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
