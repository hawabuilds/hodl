import {json} from "@/lib/server/http";
import {callerId} from "@/lib/server/auth";
import {tokensTablePage} from "@/lib/server/tokensTable";
import {decodeCursor, parseSort, parseTab} from "@/lib/tokensTable";

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
