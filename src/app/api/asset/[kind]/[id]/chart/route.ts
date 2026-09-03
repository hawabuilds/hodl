import type {NextRequest} from "next/server";
import {json, notFound, parseKind, parseTimeframe, publicJson} from "@/lib/server/http";
import {fetchAsset, fetchChart} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const timeframe = parseTimeframe(request.nextUrl.searchParams.get("tf"));
  const {data: points, seeded} = await fetchChart(asset, timeframe);

  const first = points[0]?.price ?? 0;
  const last = points[points.length - 1]?.price ?? 0;

  return publicJson({
    timeframe,
    points,
    // The header change follows the window on screen, not a fixed 24 hours —
    // a 5m chart showing a 24h percentage would be reading the wrong number.
    changePct: first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
    seeded,
  }, {maxAge: 30, swr: 300});
}
