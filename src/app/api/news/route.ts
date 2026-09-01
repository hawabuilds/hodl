import type {NextRequest} from "next/server";
import {json} from "@/lib/server/http";
import {fetchFeed} from "@/lib/server/sources";
import {NEWS_TOPICS, NEWS_WINDOWS, type NewsTopic, type NewsWindow} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const window =
    (NEWS_WINDOWS.find((w) => w === params.get("window")) as NewsWindow) ?? "7d";
  const topic =
    (NEWS_TOPICS.find((t) => t === params.get("topic")) as NewsTopic) ?? "all";

  const {data, seeded} = await fetchFeed({
    window,
    topic,
    query: params.get("q") ?? undefined,
  });

  return json({items: data, window, topic, seeded});
}
