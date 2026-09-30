import {PAGE_EDGE, json, publicJson, queryKey} from "@/lib/server/http";
import {cached} from "@/lib/server/live/cache";
import {callerId} from "@/lib/server/auth";
import {tokensTablePage} from "@/lib/server/tokensTable";
import {decodeCursor, parseSort, parseTab} from "@/lib/tokensTable";

/** How long a built public page (Trending, New) is reused before one request rebuilds it. */
const PUBLIC_TTL_MS = 10_000;

const cleanStock = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9.]{1,12}$/.test(value) ? value : null;

/**
 * Trending and New: the same rows for every reader, so a GET the edge can
 * hold. Built every 10s; the DexScreener round trip in the build happens
 * behind a served copy. Following and Watchlist, which depend on who is
 * asking, stay on POST below.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tab = parseTab(params.get("tab"));
  if (tab !== "trending" && tab !== "new") return json({error: "Use POST for this tab."}, 405);
  const sort = parseSort(params.get("sort"), tab);
  let cursor = null;
  try {
    cursor = decodeCursor(params.get("cursor") ? JSON.parse(params.get("cursor") as string) : null);
  } catch {
    cursor = null;
  }
  try {
    const body = await cached(queryKey("page:tokens-table", params), PUBLIC_TTL_MS, () =>
      tokensTablePage({
        tab,
        sort,
        desc: params.get("dir") !== "asc",
        stock: cleanStock(params.get("stock")),
        cursor,
        watch: [],
        callerId: null,
      }),
    );
    return publicJson(body, PAGE_EDGE);
  } catch (error) {
    console.error("tokens table page failed", error);
    return json({error: "Couldn't load tokens."}, 503);
  }
}

export const dynamic = "force-dynamic";

/**
 * One page of the desktop Tokens table. POST so a watchlist of any size fits
 * in the body. Following needs the caller; the other tabs do not.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tab = parseTab(body.tab);
  const sort = parseSort(body.sort, tab);
  const stock =
    typeof body.stock === "string" && /^[A-Za-z0-9.]{1,12}$/.test(body.stock) ? body.stock : null;
  const watch = Array.isArray(body.watch)
    ? body.watch.filter((id): id is string => typeof id === "string").slice(0, 500)
    : [];
  const caller = tab === "following" ? await callerId(request) : null;
  if (tab === "following" && !caller) {
    return json({rows: [], next: null, pairs: [], signedOut: true});
  }
  try {
    return json(
      await tokensTablePage({
        tab,
        sort,
        desc: body.dir !== "asc",
        stock,
        cursor: decodeCursor(body.cursor),
        watch,
        callerId: caller,
      }),
    );
  } catch (error) {
    console.error("tokens table page failed", error);
    return json({error: "Couldn't load tokens."}, 503);
  }
}
