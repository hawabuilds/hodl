import {json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data, seeded} = await fetchAsset(kind, params.id);
  if (!data) return notFound("No asset with that id.");

  return json({asset: data, seeded});
}
