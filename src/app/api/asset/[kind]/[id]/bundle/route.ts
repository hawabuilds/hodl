import type {NextRequest} from "next/server";
import {notFound, parseKind, parseTimeframe, json} from "@/lib/server/http";
import {fetchAssetPage} from "@/lib/server/sources";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const timeframe = parseTimeframe(request.nextUrl.searchParams.get("tf"));
  const {data, seeded} = await fetchAssetPage(kind, params.id, timeframe);
  if (!data) return notFound("No asset with that id.");

  return json({
    asset: data.asset,
    seeded,
    chart: {...data.chart, seeded},
    trades: {...data.trades, seeded},
  });
}
