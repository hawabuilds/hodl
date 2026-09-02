import {json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset, fetchTrades} from "@/lib/server/sources";
import {AUTHENTICATED} from "@/lib/server/live/geckoterminal";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  // The upstream returns three hundred fills in one call and the tape is meant
  // to be scrolled, so forty was throwing away most of what had been fetched —
  // the panel looked stale against any explorer showing the same pool.
  const {data, seeded} = await fetchTrades(asset, 300);
  // The client cannot know which upstream plan is configured, and polling
  // faster than the server can refresh just re-serves one cached answer.
  return json({trades: data, seeded, pollMs: AUTHENTICATED ? 2_000 : 12_000});
}
