"use client";

import {useCallback, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {NEWS_FEED_QUERY_KEY} from "@/lib/newsWindow";
import type {FeedItem} from "@/lib/types";

/** The window and topic the News tab lands on. */
const DEFAULT_WINDOW = "24h";
const DEFAULT_TOPIC = "all";

/**
 * Warms the News tab's default feed before it is opened.
 *
 * Building the feed fetches the wire, the X accounts and up to ninety article
 * pages for their artwork, so a cold shared cache can take several seconds —
 * and that whole wait, images included, used to land after the tap, right
 * when someone is looking at a blank tab. Firing the same request the tab
 * itself would make, on hover or press the way an asset row already does,
 * moves that wait earlier so the JSON — and the article images the browser
 * starts fetching as soon as it has their URLs — are already in flight by the
 * time the page mounts.
 */
export function usePrefetchNews() {
  const queryClient = useQueryClient();
  const warmed = useRef(false);

  return useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;

    const url = `/api/news?window=${DEFAULT_WINDOW}&topic=${DEFAULT_TOPIC}`;

    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;

        const data = (await res.json()) as {
          items: FeedItem[];
          seeded: boolean;
        };

        if (!Array.isArray(data.items) || data.items.length === 0) return;

        queryClient.setQueryData(
          [NEWS_FEED_QUERY_KEY, DEFAULT_WINDOW, DEFAULT_TOPIC],
          data,
        );
      } catch {
        // Best-effort: a failed warm just means the tab loads the old way.
      }
    })();
  }, [queryClient]);
}
