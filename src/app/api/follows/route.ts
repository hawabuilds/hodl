import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {followingOf, setFollow} from "@/lib/server/social-live";

export const dynamic = "force-dynamic";

/** Who the caller follows. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  return json({following: await followingOf(caller.userId)});
}

/** Follow or unfollow, decided by `following` in the body. */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as {
    handle?: string;
    following?: boolean;
  };
  if (!body.handle) return badRequest("Which account?");

  const wantFollow = body.following !== false;
  const result = await setFollow(caller.userId, body.handle, wantFollow);
  if (!result.ok) return badRequest("No account with that handle.");

  const following = followingOf(caller.userId);
  if (wantFollow && result.targetId) {
    const {notifyFollowed} = await import("@/lib/server/notifications/social");
    await Promise.all([
      following,
      notifyFollowed(result.targetId, caller.userId).catch((error) =>
        console.error("follow notify failed", error),
      ),
    ]);
    return json({following: await following});
  }

  return json({following: await following});
}
