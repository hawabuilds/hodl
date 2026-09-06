import type {NextRequest} from "next/server";
import {json, notFound, parseKind, parseTimeframe} from "@/lib/server/http";
import {fetchAsset, fetchChart} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const timeframe = parseTimeframe(request.nextUrl.searchParams.get("tf"));

  try {
    const asset = await fetchAsset(kind, params.id);
    if (!asset.data) return notFound("No asset with that id.");

    const chart = await fetchChart(asset.data, timeframe, false);
    const first = chart.data[0]?.price ?? 0;
    const last = chart.data[chart.data.length - 1]?.price ?? 0;
    const resolvedTimeframe = chart.resolvedTimeframe ?? timeframe;
    return json({
      timeframe,
      resolvedTimeframe,
      points: chart.data,
      changePct:
        first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
      seeded: false,
      empty: chart.data.length === 0,
      error: chart.error ?? null,
    });
  } catch (error) {
    console.error("chart route failed", error);
    return json({error: "Couldn't load the chart. Retrying.", empty: false}, 503);
  }
}
