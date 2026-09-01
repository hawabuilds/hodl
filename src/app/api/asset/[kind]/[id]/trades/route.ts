import {json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset, fetchTrades} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const {data, seeded} = await fetchTrades(asset, 40);
  return json({trades: data, seeded});
}
