import {badRequest, json, notFound, parseKind, publicJson} from "@/lib/server/http";
import {fetchAsset, fetchNews} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

/** RWAs only — a token has no issuer for a newsroom to write about. */
export async function GET(
  _request: Request,
  context: {params: Promise<{kind: string; id: string}>},
) {
  const params = await context.params;
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");
  if (kind !== "rwa") return badRequest("News is only published for RWAs.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset || asset.kind !== "rwa") return notFound("No RWA with that id.");

  const {data, seeded, error} = await fetchNews(asset);
  // `seeded` is what the UI reads to label these as samples rather than
  // reporting. Do not drop it when a real provider is wired in.
  return publicJson(
    {items: data, seeded, error: error ?? null},
    {maxAge: 300, swr: 1800},
  );
}
