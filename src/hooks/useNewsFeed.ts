"use client";

import {useCallback, useEffect} from "react";
import {useQuery, useQueryClient, type QueryClient} from "@tanstack/react-query";
import {
  NEWS_DEFAULT_TOPIC,
  NEWS_DEFAULT_WINDOW,
  NEWS_FEED_QUERY_KEY,
} from "@/lib/newsWindow";
import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";

export interface FeedResponse {
  items: FeedItem[];
  seeded: boolean;
}

/** How long a fetched feed is served without refetching. */
export const NEWS_STALE_MS = 60_000;

/**
 * One definition of the News request, shared by the tab that reads it and the
 * tab bar that warms it.
 *
 * They used to be two: the page held an inline queryFn, and the warm did a
 * bare fetch and pushed the result in with setQueryData. Because the warm
 * fires on press, the page mounted a moment later, found nothing cached yet,
 * and issued a second identical request that it then waited on — so the warm
 * cost an extra round trip and saved nothing. Sharing the key and the function
 * lets React Query dedupe: the page attaches to the request already in flight.
 */
export function newsFeedQuery(window: NewsWindow, topic: NewsTopic) {
  return {
    queryKey: [NEWS_FEED_QUERY_KEY, window, topic] as const,
    staleTime: NEWS_STALE_MS,
    queryFn: async (): Promise<FeedResponse> => {
      const res = await fetch(`/api/news?window=${window}&topic=${topic}`);
      if (!res.ok) throw new Error("Could not load the news feed.");
      return (await res.json()) as FeedResponse;
    },
  };
}

export function useNewsFeed(window: NewsWindow, topic: NewsTopic) {
  return useQuery({
    ...newsFeedQuery(window, topic),
    refetchInterval: 2 * 60_000,
  });
}

function warm(client: QueryClient): void {
  // prefetchQuery is a no-op while the data is still fresh, so this is safe to
  // call on every press rather than once per session the way the old ref was.
  void client
    .prefetchQuery(newsFeedQuery(NEWS_DEFAULT_WINDOW, NEWS_DEFAULT_TOPIC))
    .catch(() => {
      // Best effort: a failed warm just means the tab loads the old way.
    });
}

/**
 * Warms the feed the News tab opens on.
 *
 * Press is already too late to hide a cold wire build, so the bar also warms
 * once the app has gone idle. By the time the tab is tapped the response is
 * usually cached, which is the difference between News feeling like the other
 * three tabs and feeling like a page load.
 */
export function usePrefetchNews() {
  const client = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Typed as always present, but Safari only shipped it in 16.4.
    const idle: typeof window.requestIdleCallback | undefined =
      window.requestIdleCallback;
    if (idle) {
      const id = idle(() => warm(client), {timeout: 3_000});
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => warm(client), 1_500);
    return () => window.clearTimeout(id);
  }, [client]);

  return useCallback(() => warm(client), [client]);
}
