import {json} from "@/lib/server/http";
import {rwasBoardPage} from "@/lib/server/rwasBoard";
import {parseCategory, parseRwaSort} from "@/lib/rwaBoard";

export const dynamic = "force-dynamic";

/**
 * One page of the desktop RWAs list. POST so a watchlist of any size fits in
 * the body; the rows themselves are the same for everyone.
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
