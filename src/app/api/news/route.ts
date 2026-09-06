import {unstable_cache} from "next/cache";
import type {NextRequest} from "next/server";
import {json, publicJson} from "@/lib/server/http";
import {fetchFeed} from "@/lib/server/sources";
import {NEWS_TOPICS, NEWS_WINDOWS, type NewsTopic, type NewsWindow} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The feed, built once and shared.
 *
 * Building it fetches the wire, the X accounts and up to ninety article pages
 * for their artwork — several seconds on a cold instance, and every instance
 * was paying it separately because the caches underneath are per process. The
 * built list goes through the shared data cache instead, so the first request
 * anywhere pays and the rest read it.
 *
 * Windows and topics are filters over the same list, so they share one entry
 * rather than each warming their own.
 */
const feed = unstable_cache(
  async () => {
    const result = await fetchFeed({window: "all", topic: "all"});
    // X-only is not a cacheable win — Finnhub missed and posts filled the
    // array. Throwing skips the Data Cache so the next request retries.
    if (!result.data.some((item) => item.kind === "article")) {
      throw new Error("news wire empty");
    }
    return result;
  },
  // Bumped whenever sort/source logic changes: Vercel's Data Cache outlives
  // a deploy, so an old key would keep serving the previous feed.
  ["news-feed-v6"],
  {revalidate: 300},
);

const WINDOW_MS: Record<NewsWindow, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const window =
    (NEWS_WINDOWS.find((w) => w === params.get("window")) as NewsWindow) ?? "7d";
  const topic =
    (NEWS_TOPICS.find((t) => t === params.get("topic")) as NewsTopic) ?? "all";

  let data: Awaited<ReturnType<typeof fetchFeed>>["data"];
  let seeded: boolean;
  try {
    ({data, seeded} = await feed());
  } catch {
    ({data, seeded} = await fetchFeed({window: "all", topic: "all"}));
  }

  const cutoff = Date.now() - WINDOW_MS[window];
  const items = data
    .filter((item) => {
      if (Date.parse(item.publishedAt) < cutoff) return false;
      if (topic === "posts") return item.kind === "account";
      if (topic === "all") return true;
      return item.topic === topic;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  return publicJson({items, window, topic, seeded}, {maxAge: 120, swr: 900});
}
