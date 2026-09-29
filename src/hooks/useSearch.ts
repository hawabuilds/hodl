"use client";

import {useEffect, useState} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {applyCachedAssets, rememberTokens} from "@/lib/tokenCache";
import type {Asset, Profile, TokenAsset} from "@/lib/types";

export interface SearchResponse {
  results: Asset[];
  rwas?: Asset[];
  tokens?: Asset[];
  people: Profile[];
  ineligible?: boolean;
}

/**
 * People, stocks and tokens matching what has been typed.
 *
 * Shared by the search tab and the desktop top bar's search box, which run
 * the same query under the same key, so moving from one to the other finds
 * the answer already cached.
 */
export function useSearch(query: string) {
  const [debounced, setDebounced] = useState("");

  // Debounced rather than fired per keystroke: a pasted address arrives as one
  // change, but a typed ticker arrives as four, and three of those responses
  // are answers nobody reads.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(id);
  }, [query]);

  const trimmed = debounced.trim();
  const active = trimmed.length > 0;

  const search = useQuery({
    queryKey: ["search-all", trimmed],
    enabled: active,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    // Once, not the default three: someone is waiting on this with the box
    // open, and three backed-off retries of a slow query is half a minute of
    // "Searching…" before they learn anything.
    retry: 1,
    queryFn: async () => {
      const res = await fetch(
        `/api/search?people=1&q=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) throw new Error("Search failed.");
      const data = (await res.json()) as SearchResponse;
      const tokens = (data.tokens ?? data.results ?? []).filter(
        (asset): asset is TokenAsset => asset.kind === "token",
      );
      rememberTokens(tokens);
      return {
        ...data,
        results: applyCachedAssets(data.results ?? []),
        tokens: applyCachedAssets(data.tokens ?? []),
        rwas: data.rwas ?? [],
      };
    },
  });

  return {search, trimmed, active};
}
