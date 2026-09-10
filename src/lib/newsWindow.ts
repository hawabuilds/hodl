import {startOfLocalDay} from "@/lib/format";
import type {NewsWindow} from "@/lib/types";

/** React Query key prefix. Bump with wire/window changes so a stale empty cache cannot stick. */
export const NEWS_FEED_QUERY_KEY = "news-feed-v11";

/** How long a Next/CDN news build may be reused before origin must rebuild. */
export const NEWS_BUILD_FRESH_MS = 90_000;

/**
 * The chips the News tab lands on, and the ones the tab bar warms on press.
 *
 * Both the page's initial state and the prefetch read these. They were once
 * two literals in two files, and when the default chip moved to `latest` the
 * warm kept fetching `24h` — priming a cache key the tab never read, so every
 * open paid the full wire build it was supposed to skip.
 */
export const NEWS_DEFAULT_WINDOW: NewsWindow = "latest";
export const NEWS_DEFAULT_TOPIC = "all";

/**
 * Newest wire article older than this means the feed snapshot is stale even
 * when `builtAt` is fresh — e.g. Data Cache served a 19:03 build at 21:20.
 */
export const NEWS_WIRE_STALE_MS = 2 * 60 * 60_000;

/**
 * Server lookback per chip.
 *
 * `latest` is a rolling 24h window — the default chip.
 *
 * The Today chip (`24h`) is a local calendar day. Fetch 48h and let the client
 * clip to midnight so timezones ahead of UTC still overlap.
 */
export const NEWS_WINDOW_MS: Record<NewsWindow, number> = {
  latest: 24 * 3_600_000,
  "24h": 48 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

/**
 * Stories for the Today chip.
 *
 * Prefer this local calendar day. If that would empty the tab while the
 * payload still has stories (timezone overlap, unparseable stamps, a 24h
 * CDN copy that only held last night), keep the payload so Today never
 * sticks on "Nothing in this window" when data exists.
 */
export function selectTodayStories<T extends {publishedAt: string}>(
  items: T[],
  now: number = Date.now(),
): T[] {
  if (items.length === 0) return items;
  const start = startOfLocalDay(now);
  const today = items.filter((item) => {
    const at = Date.parse(item.publishedAt);
    return !Number.isFinite(at) || at >= start;
  });
  return today.length > 0 ? today : items;
}
