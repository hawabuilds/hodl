"use client";

import {useCallback, useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {
  readWatchlist,
  toggleWatch,
  watchKey,
  type WatchKey,
} from "@/lib/localStore";
import type {Asset, AssetKind} from "@/lib/types";
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
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/assets?ids=${encodeURIComponent(ids.join(","))}`);
      if (!res.ok) throw new Error("Could not load your watchlist.");
      return (await res.json()) as {assets: Asset[]};
    },
  });

  return {
    assets: query.data?.assets ?? [],
    count,
    isLoading: enabled && ids.length > 0 && query.isLoading,
  };
}
