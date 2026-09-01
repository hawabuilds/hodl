"use client";

import {useCallback} from "react";
import {
  readWatchlist,
  toggleWatch,
  watchKey,
  type WatchKey,
} from "@/lib/localStore";
import type {AssetKind} from "@/lib/types";
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
