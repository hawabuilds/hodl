import {json, notFound, parseKind} from "@/lib/server/http";
import {tapePollMs} from "@/lib/server/live/rpcProviders";
import {fetchAsset, fetchTrades} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {params: Promise<{kind: string; id: string}>},
) {
  const params = await context.params;
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset, seeded: assetIsSeeded} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const {data, seeded, error, liveDown} = await fetchTrades(
    asset,
    300,
    assetIsSeeded,
  );

  // On-chain head reads need a fresh response every poll, not an edge cache.
  return json({
    trades: data,
    seeded,
    pollMs: tapePollMs(),
    error: error ?? null,
    liveDown: liveDown ?? false,
  });
}
