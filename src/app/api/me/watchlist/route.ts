import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {listWatchlist, setWatchlistItem} from "@/lib/server/notifications/watchlist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const rows = await listWatchlist(caller.userId);
  return json({
    keys: rows.map((row) => `${row.kind}:${row.assetId}`),
    items: rows,
  });
}

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    id?: string;
    watching?: boolean;
    addPrice?: number | null;
  };
  if (body.kind !== "token" && body.kind !== "rwa") return badRequest("Which kind?");
  if (!body.id) return badRequest("Which asset?");
  const ok = await setWatchlistItem({
    userId: caller.userId,
    kind: body.kind,
    assetId: body.id,
    watching: body.watching !== false,
    addPrice: typeof body.addPrice === "number" ? body.addPrice : null,
  });
  if (!ok) return badRequest("Watchlist could not be saved.");
  const rows = await listWatchlist(caller.userId);
  return json({keys: rows.map((row) => `${row.kind}:${row.assetId}`)});
}
