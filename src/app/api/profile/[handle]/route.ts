import {json, notFound} from "@/lib/server/http";
import {connectionsFor, getProfile} from "@/lib/server/social";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {params}: {params: {handle: string}},
) {
  const profile = getProfile(params.handle);
  if (!profile) return notFound("No profile with that handle.");

  return json({
    profile,
    followerHandles: connectionsFor(profile.handle, "followers"),
    followingHandles: connectionsFor(profile.handle, "following"),
  });
}
