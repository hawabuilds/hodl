import {badRequest, json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset} from "@/lib/server/sources";
import {commentsFor as seededComments} from "@/lib/server/social";
import {addComment, commentsFor, holdsAsset} from "@/lib/server/social-live";
import {callerId, requireCaller} from "@/lib/server/auth";
import {hasDatabase} from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Threads for an asset, oldest first. */
export async function GET(
  request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  if (hasDatabase) {
    // Anonymous is fine here: it only decides whether each comment comes back
    // marked as liked by you, and whether the composer is open.
    const viewer = await callerId(request);
    const [rows, canPost] = await Promise.all([
      commentsFor(asset.id, viewer),
      viewer ? holdsAsset(viewer, asset.id) : Promise.resolve(false),
    ]);
    // An empty thread is a real answer, so it is returned rather than falling
    // back to the seeded conversation and inventing one.
    return json({comments: rows, localOnly: false, canPost});
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

  /*
   * Holding is what earns a say.
   *
   * Checked here and not only in the composer: the composer is a courtesy,
   * this is the rule. A position read that fails counts as not holding, so a
   * post is refused rather than let through on a database hiccup.
   */
  if (!(await holdsAsset(caller.userId, asset.id))) {
    const ticker = asset.kind === "rwa" ? asset.ticker : asset.symbol;
    return json({error: `Hold ${ticker} to comment on it.`}, 403);
  }

  const comment = await addComment({
    userId: caller.userId,
    assetId: asset.id,
    parentId: body.parentId ?? null,
    body: text,
  });

  if (!comment) return badRequest("That comment could not be saved.");
  if (comment.parentId) {
    const {notifyCommentReply} = await import("@/lib/server/notifications/social");
    await notifyCommentReply({
      commentId: comment.id,
      parentId: comment.parentId,
      assetId: asset.id,
      authorId: caller.userId,
      body: text,
      ticker: asset.kind === "rwa" ? asset.ticker : asset.symbol,
    }).catch((error) => console.error("reply notify failed", error));
  }
  return json({comment});
}
