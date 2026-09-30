"use client";

import {useCallback, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";

import {loadHomeBundle} from "@/hooks/useHomeBundle";
import {RWAS_OVERVIEW_KEY, allRwasKey, fetchAllRwasPage, fetchRwasOverview} from "@/hooks/useRwasBoard";
import {fetchPublicTokensPage, publicTokensKey} from "@/hooks/useTokensTable";
import {DEFAULT_ORDER, type TokensCursor} from "@/lib/tokensTable";

/** A page is warmed at most this often, however many times its link is hovered. */
const AGAIN_AFTER_MS = 20_000;

/**
 * Start a page's data the moment its top-bar link is hovered or focused, into
 * the same cache keys the page reads, so the click lands on a page that is
 * already filled. Public data only — nothing personal is warmed this way.
 */
export function usePrefetchPage() {
  const queryClient = useQueryClient();
  const last = useRef(new Map<string, number>());

  return useCallback(
    (href: string) => {
      const now = Date.now();
      if (now - (last.current.get(href) ?? 0) < AGAIN_AFTER_MS) return;
      last.current.set(href, now);

      if (href === "/home") {
        void loadHomeBundle(queryClient);
      } else if (href === "/tokens") {
        const order = DEFAULT_ORDER.trending;
        void queryClient.prefetchInfiniteQuery({
          queryKey: publicTokensKey("trending", order, null),
          queryFn: ({pageParam}) =>
            fetchPublicTokensPage({tab: "trending", order, stock: null}, pageParam as TokensCursor | null),
          initialPageParam: null as TokensCursor | null,
          staleTime: 10_000,
        });
      } else if (href === "/rwas") {
        void queryClient.prefetchQuery({queryKey: RWAS_OVERVIEW_KEY, queryFn: fetchRwasOverview, staleTime: 15_000});
        void queryClient.prefetchInfiniteQuery({
          queryKey: allRwasKey("all", "popular"),
          queryFn: ({pageParam}) => fetchAllRwasPage("all", "popular", pageParam as number),
          initialPageParam: 0,
          staleTime: 30_000,
        });
      }
    },
    [queryClient],
  );
}
