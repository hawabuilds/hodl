import {startOfLocalDay} from "@/lib/format";
import type {NewsWindow} from "@/lib/types";

/** React Query key prefix. Bump with wire/window changes so a stale empty cache cannot stick. */
export const NEWS_FEED_QUERY_KEY = "news-feed-v10";

/** How long a Next/CDN news build may be reused before origin must rebuild. */
export const NEWS_BUILD_FRESH_MS = 90_000;

/**
 * Server lookback per chip.
 *
 * The Today chip is a local calendar day, not a rolling 24h. A UTC slice that
 * ends at "now minus 24h" misses the start of today in timezones ahead of UTC
 * and, worse, leaves the client with only last-night items that the local-day
 * filter then drops — the empty Today glitch. Fetch 48h and let the client
 * clip to midnight.
 */
export const NEWS_WINDOW_MS: Record<NewsWindow, number> = {
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
