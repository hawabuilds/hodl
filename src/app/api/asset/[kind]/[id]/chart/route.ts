import type {NextRequest} from "next/server";
import {notFound, parseKind, parseTimeframe, publicJson} from "@/lib/server/http";
import * as live from "@/lib/server/live/market";
import * as gecko from "@/lib/server/live/geckoterminal";
import * as seeded from "@/lib/server/market";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const timeframe = parseTimeframe(request.nextUrl.searchParams.get("tf"));

  try {
    const target = await live.poolFor(kind, params.id);
    if (target) {
      const points = await gecko.candles(target.pool, timeframe);
      if (points.length > 1) {
        const first = points[0]?.price ?? 0;
        const last = points[points.length - 1]?.price ?? 0;
        return publicJson(
          {
            timeframe,
            points,
            changePct:
              first > 0
                ? Number((((last - first) / first) * 100).toFixed(2))
                : 0,
            seeded: false,
          },
          {maxAge: 30, swr: 300},
        );
      }
    }
  } catch (error) {
    console.error("live chart failed", error);
  }

  const asset = seeded.getAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const points = seeded.chartFor(asset, timeframe);
  const first = points[0]?.price ?? 0;
  const last = points[points.length - 1]?.price ?? 0;

  return publicJson(
    {
      timeframe,
      points,
      changePct:
        first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
      seeded: true,
    },
    {maxAge: 30, swr: 300},
  );
}
