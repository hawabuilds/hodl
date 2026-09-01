import {json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset} from "@/lib/server/sources";
import {commentsFor} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/**
 * Read-only for now.
 *
 * Posting is handled in the browser (`localStore.writeLocalComment`) because
 * there is no database behind this yet; the client merges what it has written
 * into this list. When Supabase lands, a POST here replaces that merge and the
 * UI does not otherwise change.
 */
export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  return json({comments: commentsFor(asset), localOnly: true});
}
