import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {hasDatabase} from "@/lib/server/db";
import {setCommentLike} from "@/lib/server/social-live";

export const dynamic = "force-dynamic";

/**
 * Like or unlike a comment.
 *
 * Liking is open to anyone signed in — only speaking about an asset requires
 * holding it. Identity comes from the token, never the body, so a caller can
 * only ever like as themselves.
 *
 * The new tally is returned rather than assumed by the client, because two
 * devices liking at once should not be able to end up disagreeing about the
 * count.
 */
export async function POST(
  request: Request,
  {params}: {params: {id: string}},
) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!hasDatabase) return json({error: "Comments are not configured."}, 503);

  const body = (await request.json().catch(() => ({}))) as {liked?: boolean};

  const result = await setCommentLike({
    commentId: params.id,
    userId: caller.userId,
    liked: body.liked !== false,
  });

  if (!result) return json({error: "That like did not save."}, 503);
  return json(result);
}
