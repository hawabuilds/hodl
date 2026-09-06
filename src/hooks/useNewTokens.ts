"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {keepPreviousData, useInfiniteQuery} from "@tanstack/react-query";
import type {TokenAsset} from "@/lib/types";
import {applyCachedToken, rememberTokens} from "@/lib/tokenCache";
import {decodeTokenImage} from "./useFeedLogos";

export interface NewTokenFilters {
  launchpad?: "pons" | "long" | "";
  quote?: "rwa" | "eth" | "usdg" | "";
  rewards?: boolean;
  minLiq?: number | null;
  maxLiq?: number | null;
  minMcap?: number | null;
  maxMcap?: number | null;
  minVol?: number | null;
  maxVol?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
}

interface Page {
  tokens: TokenAsset[];
  cursor: string | null;
  hasMore: boolean;
}

/** Live poll vs first-page query: arrivals vs tokens that later gained art. */
export function splitNewFeedPoll(
  incoming: TokenAsset[],
  seenIds: Set<string>,
): {fresh: TokenAsset[]; gainedArt: TokenAsset[]} {
  const fresh: TokenAsset[] = [];
  const gainedArt: TokenAsset[] = [];
  for (const token of incoming) {
    if (!seenIds.has(token.id)) {
      fresh.push(token);
      continue;
    }
    if (token.imageUrl || token.imageUrl64) gainedArt.push(token);
  }
  return {fresh, gainedArt};
}

function queryString(filters: NewTokenFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (cursor) params.set("cursor", cursor);
  if (filters.launchpad) params.set("launchpad", filters.launchpad);
  if (filters.quote) params.set("quote", filters.quote);
  if (filters.rewards) params.set("rewards", "rwa");
  if (filters.minLiq) params.set("minLiq", String(filters.minLiq));
  if (filters.maxLiq) params.set("maxLiq", String(filters.maxLiq));
  if (filters.minMcap) params.set("minMcap", String(filters.minMcap));
  if (filters.maxMcap) params.set("maxMcap", String(filters.maxMcap));
  if (filters.minVol) params.set("minVol", String(filters.minVol));
  if (filters.maxVol) params.set("maxVol", String(filters.maxVol));
  if (filters.minAge) params.set("minAge", String(filters.minAge));
  if (filters.maxAge) params.set("maxAge", String(filters.maxAge));
  return params.toString();
}

export function useNewTokens(filters: NewTokenFilters, enabled: boolean) {
  const seen = useRef(new Set<string>());
  const [live, setLive] = useState<TokenAsset[]>([]);

  const feed = useInfiniteQuery({
    queryKey: ["tokens-new", filters],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    initialPageParam: null as string | null,
    queryFn: async ({pageParam}): Promise<Page> => {
      const res = await fetch(`/api/tokens/new?${queryString(filters, pageParam)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load new tokens.");
      const page = (await res.json()) as Page;
      rememberTokens(page.tokens);
      return {...page, tokens: page.tokens.map(applyCachedToken)};
    },
    getNextPageParam: (last) => (last.hasMore ? last.cursor : undefined),
  });

  const pages = useMemo(
    () => feed.data?.pages.flatMap((page) => page.tokens) ?? [],
    [feed.data],
  );

  useEffect(() => {
    seen.current = new Set(pages.map((token) => token.id));
  }, [pages]);

  useEffect(() => {
    if (!enabled) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tokens/new?${queryString(filters, null)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as Page;
        rememberTokens(body.tokens);
        const {fresh, gainedArt} = splitNewFeedPoll(body.tokens, seen.current);
        if (fresh.length === 0 && gainedArt.length === 0) return;
        await Promise.all(
          [...fresh, ...gainedArt].map((token) =>
            decodeTokenImage(token.imageUrl64 || token.imageUrl),
          ),
        );
        for (const token of fresh) seen.current.add(token.id);
        const incoming = new Map(body.tokens.map((token) => [token.id, token]));
        setLive((held) => [
          ...fresh.map(applyCachedToken),
          ...held
            .filter((row) => !fresh.some((item) => item.id === row.id))
            .map((row) => {
              const next = incoming.get(row.id);
              return next ? applyCachedToken(next) : row;
            }),
        ]);
      } catch {
        // next poll
      }
    };
    const id = window.setInterval(tick, 8_000);
    return () => window.clearInterval(id);
  }, [enabled, filters]);

  const tokens = useMemo(() => {
    const merged = [...live, ...pages];
    const out: TokenAsset[] = [];
    const ids = new Set<string>();
    for (const token of merged) {
      if (ids.has(token.id)) continue;
      ids.add(token.id);
      out.push(applyCachedToken(token));
    }
    return out;
  }, [live, pages]);

  const loadMore = useCallback(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, [feed]);

  return {
    tokens,
    isLoading: feed.isLoading,
    error: feed.error as Error | null,
    loadMore,
    hasMore: Boolean(feed.hasNextPage),
  };
}
