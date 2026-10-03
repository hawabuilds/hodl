import type {NextRequest} from "next/server";
import {json, notFound, parseKind, parseTimeframe, publicJson} from "@/lib/server/http";
import {cached} from "@/lib/server/live/cache";
import {fetchAsset, fetchAssetPage} from "@/lib/server/sources";
import {defaultChartTimeframe} from "@/lib/chartTimeframe";
export const dynamic = "force-dynamic";

const BUNDLE_TTL_MS = 5_000;
const NOT_FOUND = "asset not found";

export async function GET(
  request: NextRequest,
  context: {params: Promise<{kind: string; id: string}>},
) {
  const params = await context.params;
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  // No `tf`: the page's own default, which depends on the token's age — so
  // the chart sent is the one the page opens on, and nothing loads after it.
  const requested = request.nextUrl.searchParams.get("tf");
  let timeframe = parseTimeframe(requested);
  if (!requested) {
    const asset = await fetchAsset(kind, params.id).then((found) => found.data).catch(() => null);
    timeframe = defaultChartTimeframe({
      kind,
      listedAt: asset?.kind === "token" ? asset.listedAt : null,
    });
  }
  // A chart page's first paint, the same for every reader: rebuilt at most
  // every 5s per server and shared through Redis and the edge, so opening a
  // page rarely waits on GeckoTerminal or the chain. The asset inside keeps
  // its own last good copy; the trades poll goes live 2s after paint.
  const id = kind === "token" ? params.id.toLowerCase() : params.id.toUpperCase();
  let built: Awaited<ReturnType<typeof fetchAssetPage>>;
  try {
    built = await cached(`asset-bundle:${kind}:${id}:${timeframe}`, BUNDLE_TTL_MS, async () => {
      const result = await fetchAssetPage(kind, params.id, timeframe);
      // Nothing found is not kept: a token indexed a moment later must show.
      if (!result.data) throw new Error(NOT_FOUND);
      return result;
    });
  } catch (error) {
    if (error instanceof Error && error.message === NOT_FOUND) return notFound("No asset with that id.");
    console.error("asset bundle failed", error);
    return json({error: "Couldn't load this page."}, 503);
  }
  const {data, seeded} = built;
  if (!data) return notFound("No asset with that id.");

  return publicJson({
    asset: data.asset,
    seeded,
    chart: {...data.chart, timeframe, seeded},
    trades: {...data.trades, seeded},
  }, {maxAge: 5, swr: 60});
}
