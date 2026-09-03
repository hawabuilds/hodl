import {json, notFound} from "@/lib/server/http";
import {
  followersOf,
  followingByHandle,
  profileByHandle,
} from "@/lib/server/social-live";
import {holdingsFor} from "@/lib/server/live/holdings";
import {hasDatabase} from "@/lib/server/db";
import {connectionsFor, getProfile} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/**
 * Somebody else's profile.
 *
 * Real throughout when the database is configured: the account, both sides of
 * its follow graph, and the holdings read from the wallet it signed in with.
 * Those holdings come from the same reader as the owner's own portfolio, so a
 * profile cannot show a different position to the person looking at their own.
 */
export async function GET(
  _request: Request,
  {params}: {params: {handle: string}},
) {
  if (hasDatabase) {
    const profile = await profileByHandle(params.handle);
    if (profile) {
      const [followerHandles, followingHandles, wallet] = await Promise.all([
        followersOf(profile.handle),
        followingByHandle(profile.handle),
        // A profile with no wallet on file is a real state, not an error: the
        // account exists, it just has nothing on chain to show.
        profile.wallet && profile.wallet !== "0x"
          ? holdingsFor(profile.wallet)
          : Promise.resolve({holdings: [], ethBalance: 0, degraded: false}),
      ]);

      return json({
        profile: {...profile, holdings: wallet.holdings},
        followerHandles,
        followingHandles,
        seeded: false,
      });
    }
  }

  // With a database configured, an account that is not in it does not exist —
  // returning a seeded persona would invent the person being looked up.
  if (hasDatabase) return notFound("No profile with that handle.");

  const seeded = getProfile(params.handle);
  if (!seeded) return notFound("No profile with that handle.");

  return json({
    profile: seeded,
    followerHandles: connectionsFor(seeded.handle, "followers"),
    followingHandles: connectionsFor(seeded.handle, "following"),
    seeded: true,
  });
}
