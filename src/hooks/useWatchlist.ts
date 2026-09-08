"use client";

import {useCallback, useEffect, useMemo, useRef} from "react";
import {keepPreviousData, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  readWatchlist,
  toggleWatch,
  watchKey,
  writeWatchlist,
  type WatchKey,
} from "@/lib/localStore";
import {MARKET_REFRESH_MS} from "@/config/market";
import type {Asset, AssetKind, TokenAsset} from "@/lib/types";
import {applyCachedAssets, rememberTokens} from "@/lib/tokenCache";
import {useSession} from "@/lib/session";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";
import {requestPushIntent} from "@/components/PushPrompt";

export function useWatchlist() {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const [localKeys] = useLocalStore<WatchKey[]>(readWatchlist, []);
  const live = user.authenticated && session.mode === "privy";

  const remote = useQuery({
    queryKey: ["watchlist", user.user?.id ?? ""],
    enabled: live,
    queryFn: async () => {
      const token = await session.getAccessToken();
      if (!token) return [] as WatchKey[];
      const res = await fetch("/api/me/watchlist", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!res.ok) throw new Error("Could not load watchlist.");
      const data = (await res.json()) as {keys: WatchKey[]};
      return data.keys ?? [];
    },
  });

  const keys = live ? (remote.data ?? localKeys) : localKeys;

  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    if (!live || !remote.isSuccess) return;
    const leftover = localKeys.filter((key) => !keys.includes(key));
    if (leftover.length === 0) {
      migrated.current = true;
      if (localKeys.length) writeWatchlist([]);
      return;
    }
    migrated.current = true;
    void (async () => {
      const token = await session.getAccessToken();
      if (!token) return;
      for (const key of leftover) {
        const [kind, id] = key.split(":");
        if (kind !== "token" && kind !== "rwa") continue;
        if (!id) continue;
        await fetch("/api/me/watchlist", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({kind, id, watching: true, addPrice: null}),
        });
      }
      writeWatchlist([]);
      await queryClient.invalidateQueries({queryKey: ["watchlist"]});
    })();
  }, [keys, live, localKeys, queryClient, remote.isSuccess, session]);

  const has = useCallback(
    (kind: AssetKind, id: string) => keys.includes(watchKey(kind, id)),
    [keys],
  );

  const toggle = useCallback(
    (kind: AssetKind, id: string, addPrice?: number | null) => {
      const nextOn = !keys.includes(watchKey(kind, id));
      if (!live) {
        toggleWatch(kind, id);
        if (nextOn) requestPushIntent("watchlist");
        return;
      }
      void (async () => {
        const token = await session.getAccessToken();
        if (!token) return;
        await fetch("/api/me/watchlist", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({kind, id, watching: nextOn, addPrice: addPrice ?? null}),
        });
        await queryClient.invalidateQueries({queryKey: ["watchlist"]});
        if (nextOn) requestPushIntent("watchlist");
      })();
    },
    [keys, live, queryClient, session],
  );

  return {keys, has, toggle, count: keys.length};
}

export function useWatchlistAssets(enabled: boolean) {
  const {keys, count} = useWatchlist();
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
