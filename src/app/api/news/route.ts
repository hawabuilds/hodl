import {unstable_cache} from "next/cache";
import type {NextRequest} from "next/server";
import {NEWS_BUILD_FRESH_MS, NEWS_WINDOW_MS} from "@/lib/newsWindow";
import {json, publicJson} from "@/lib/server/http";
import {fetchFeed} from "@/lib/server/sources";
import {NEWS_TOPICS, NEWS_WINDOWS, type NewsTopic, type NewsWindow} from "@/lib/types";

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
    ["news-feed-v10", bucket],
    {revalidate: 60},
  );
}

async function loadFeed(): Promise<{
  data: Awaited<ReturnType<typeof fetchFeed>>["data"];
  seeded: boolean;
  builtAt: number;
}> {
  const bucket = String(Math.floor(Date.now() / 60_000));
  try {
    const result = await cachedFeed(bucket)();
    if (Date.now() - result.builtAt > NEWS_BUILD_FRESH_MS) {
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
    (NEWS_WINDOWS.find((w) => w === params.get("window")) as NewsWindow) ?? "24h";
  const topic =
    (NEWS_TOPICS.find((t) => t === params.get("topic")) as NewsTopic) ?? "all";

  const {data, seeded, builtAt} = await loadFeed();

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
  if (items.length === 0 || Date.now() - builtAt > NEWS_BUILD_FRESH_MS) {
    return json({items, window, topic, seeded});
  }
  return publicJson({items, window, topic, seeded}, {maxAge: 45, swr: 60});
}
