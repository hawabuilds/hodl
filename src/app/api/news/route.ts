import {unstable_cache} from "next/cache";
import type {NextRequest} from "next/server";
import {
  NEWS_BUILD_FRESH_MS,
  NEWS_WIRE_STALE_MS,
  NEWS_WINDOW_MS,
} from "@/lib/newsWindow";
import {json, publicJson} from "@/lib/server/http";
import {cachedPage} from "@/lib/server/live/cache";
import {newestAgeMs} from "@/lib/server/live/news";
import {fetchFeed} from "@/lib/server/sources";
import {
  NEWS_TOPICS,
  NEWS_WINDOWS,
  type FeedItem,
  type NewsTopic,
  type NewsWindow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The feed, built once per minute-bucket and shared.
 *
 * Building it fetches the wire, the X accounts and up to ninety article pages
 * for their artwork — several seconds on a cold instance, and every instance
 * was paying it separately because the caches underneath are per process. The
 * built list goes through the shared data cache instead, so the first request
 * anywhere pays and the rest read it.
 *
 * Windows and topics are filters over the same list, so they share one entry
 * rather than each warming their own.
 *
 * The minute bucket is part of the key: Vercel's Data Cache can keep serving
 * an old `revalidate` entry when the rebuild throws or times out, which is
 * how Tonight sat on a 19:03 snapshot while Finnhub already had 20:23 wire.
 */
function cachedFeed(bucket: string) {
  return unstable_cache(
    async () => {
      const result = await fetchFeed({window: "all", topic: "all"});
      // X-only is not a cacheable win — Finnhub missed and posts filled the
      // array. Throwing skips the Data Cache so the next request retries.
      if (!result.data.some((item) => item.kind === "article")) {
        throw new Error("news wire empty");
      }
      return {...result, builtAt: Date.now()};
    },
    ["news-feed-v11", bucket],
    {revalidate: 60},
  );
}

/** True when the cached build is too old or its newest article is hours behind the wire. */
function feedNeedsLiveRefresh(
  data: FeedItem[],
  builtAt: number,
  now: number = Date.now(),
): boolean {
  if (now - builtAt > NEWS_BUILD_FRESH_MS) return true;
  const articles = data.filter((item) => item.kind === "article");
  if (articles.length === 0) return true;
  // Trust a build that just finished; only inspect content once it has settled.
  if (now - builtAt < 30_000) return false;
  return newestAgeMs(articles, now) > NEWS_WIRE_STALE_MS;
}

async function loadFeed(): Promise<{
  data: Awaited<ReturnType<typeof fetchFeed>>["data"];
  seeded: boolean;
  builtAt: number;
}> {
  const bucket = String(Math.floor(Date.now() / 60_000));
  try {
    const result = await cachedFeed(bucket)();
    if (feedNeedsLiveRefresh(result.data, result.builtAt)) {
      const live = await fetchFeed({window: "all", topic: "all"});
      return {...live, builtAt: Date.now()};
    }
    return result;
  } catch {
    const live = await fetchFeed({window: "all", topic: "all"});
    return {...live, builtAt: Date.now()};
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const window =
    (NEWS_WINDOWS.find((w) => w === params.get("window")) as NewsWindow) ??
    "latest";
  const topic =
    (NEWS_TOPICS.find((t) => t === params.get("topic")) as NewsTopic) ?? "all";

  // The whole wire as one page: a slow or failed build hands readers the last
  // good wire instead of an error. A wire without articles is not kept.
  const {data, seeded, builtAt} = await cachedPage("page:news-feed", 30_000, async () => {
    const feed = await loadFeed();
    if (!feed.data.some((item) => item.kind === "article")) throw new Error("news wire empty");
    return feed;
  }).catch(() => loadFeed());

  const cutoff = Date.now() - NEWS_WINDOW_MS[window];
  const items = data
    .filter((item) => {
      if (Date.parse(item.publishedAt) < cutoff) return false;
      if (topic === "posts") return item.kind === "account";
      if (topic === "all") return true;
      return item.topic === topic;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  // Empty or a stuck Data Cache build must not sit on the CDN.
  if (items.length === 0 || feedNeedsLiveRefresh(data, builtAt)) {
    return json({items, window, topic, seeded});
  }
  return publicJson({items, window, topic, seeded}, {maxAge: 45, swr: 60});
}
