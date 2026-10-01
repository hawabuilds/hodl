import {PAGE_EDGE, json, publicJson, queryKey} from "@/lib/server/http";
import {cachedPage} from "@/lib/server/live/cache";
import {rwasBoardPage} from "@/lib/server/rwasBoard";
import {parseCategory, parseRwaSort} from "@/lib/rwaBoard";

export const dynamic = "force-dynamic";

/** All stocks, a category, a sort: the same for every reader, so a GET the edge can hold. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const offset = Number(params.get("offset") ?? 0);
  try {
    return publicJson(
      await cachedPage(queryKey("page:rwas-list", params), 10_000, () =>
        rwasBoardPage({
          tab: "all",
          category: parseCategory(params.get("category")),
          sort: parseRwaSort(params.get("sort")),
          offset: Number.isFinite(offset) ? offset : 0,
          watch: [],
        }),
      ),
      PAGE_EDGE,
    );
  } catch (error) {
    console.error("rwas list page failed", error);
    return json({error: "Couldn't load stocks."}, 503);
  }
}

/**
 * One page of the watchlist view. POST so a watchlist of any size fits in the
 * body; the rows themselves are the same for everyone.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const watch = Array.isArray(body.watch)
    ? body.watch.filter((ticker): ticker is string => typeof ticker === "string" && /^[A-Za-z0-9.]{1,12}$/.test(ticker)).slice(0, 300)
    : [];
  try {
    return json(
      await rwasBoardPage({
        tab: body.tab === "watchlist" ? "watchlist" : "all",
        category: parseCategory(body.category),
        sort: parseRwaSort(body.sort),
        offset: typeof body.offset === "number" && Number.isFinite(body.offset) ? body.offset : 0,
        watch,
      }),
    );
  } catch (error) {
    console.error("rwas list page failed", error);
    return json({error: "Couldn't load stocks."}, 503);
  }
}
