import {badRequest, json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset} from "@/lib/server/sources";
import {commentsFor as seededComments} from "@/lib/server/social";
import {addComment, commentsFor} from "@/lib/server/social-live";
import {requireCaller} from "@/lib/server/auth";
import {hasDatabase} from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Threads for an asset, oldest first. */
export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  if (hasDatabase) {
    const rows = await commentsFor(asset.id);
    // An empty thread is a real answer, so it is returned rather than falling
    // back to the seeded conversation and inventing one.
    return json({comments: rows, localOnly: false});
  }

  return json({comments: seededComments(asset), localOnly: true});
}

/** Posting. Identity comes from the access token, never from the body. */
export async function POST(
  request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const body = (await request.json().catch(() => ({}))) as {
    body?: string;
    parentId?: string | null;
  };
  const text = (body.body ?? "").trim();
  if (!text) return badRequest("Write something first.");

  const comment = await addComment({
    userId: caller.userId,
    assetId: asset.id,
    parentId: body.parentId ?? null,
    body: text,
  });

  if (!comment) return badRequest("That comment could not be saved.");
  return json({comment});
}
