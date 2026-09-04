"use client";

import {useCallback, useMemo} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {
  readWatchlist,
  toggleWatch,
  watchKey,
  type WatchKey,
} from "@/lib/localStore";
import {MARKET_REFRESH_MS} from "@/config/market";
import type {Asset, AssetKind, TokenAsset} from "@/lib/types";
import {applyCachedAssets, rememberTokens} from "@/lib/tokenCache";
import {useLocalStore} from "./useLocalStore";

export function useWatchlist() {
  const [keys] = useLocalStore<WatchKey[]>(readWatchlist, []);

  const has = useCallback(
    (kind: AssetKind, id: string) => keys.includes(watchKey(kind, id)),
    [keys],
  );

  const toggle = useCallback((kind: AssetKind, id: string) => {
    toggleWatch(kind, id);
  }, []);

  return {keys, has, toggle, count: keys.length};
}

/** The watched set, priced. Only fetched while the watchlist tab is showing. */
export function useWatchlistAssets(enabled: boolean) {
  const {keys, count} = useWatchlist();

  // Sorted so the query key is stable: the same set in a different order should
  // not read as a new request.
  const ids = useMemo(() => [...keys].sort(), [keys]);

  const query = useQuery({
    queryKey: ["watchlist-assets", ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: MARKET_REFRESH_MS,
    queryFn: async () => {
      const res = await fetch(
        `/api/assets?ids=${encodeURIComponent(ids.join(","))}`,
        {cache: "no-store"},
      );
      if (!res.ok) throw new Error("Could not load your watchlist.");
      const data = (await res.json()) as {assets: Asset[]};
      rememberTokens(
        data.assets.filter((asset): asset is TokenAsset => asset.kind === "token"),
      );
      return {assets: applyCachedAssets(data.assets)};
    },
  });

  return {
    assets: applyCachedAssets(query.data?.assets ?? []),
    count,
    isLoading: enabled && ids.length > 0 && query.isLoading,
  };
}
