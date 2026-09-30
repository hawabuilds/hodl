import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {commentsFromFollowing} from "@/lib/server/social-live";

export const dynamic = "force-dynamic";

/**
 * The newest comments by the people the caller follows, for Home's card.
 *
 * New because nothing else answers it: comments are only served per asset, and
 * stitching this from those would take a request per asset and still miss
 * anything said off the assets on screen.
 */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  try {
    return json({comments: await commentsFromFollowing(caller.userId, 3)});
  } catch (error) {
    console.error("following comments failed", error);
    return json({error: "Couldn't load comments."}, 503);
  }
}
