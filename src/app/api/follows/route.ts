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

  const ok = await setFollow(
    caller.userId,
    body.handle,
    body.following !== false,
  );
  if (!ok) return badRequest("No account with that handle.");

  return json({following: await followingOf(caller.userId)});
}
