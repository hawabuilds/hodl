import {callerId} from "@/lib/server/auth";
import {dataUnavailable, json, notFound} from "@/lib/server/http";
import {
  followersOf,
  followingByHandle,
  portfolioPublicForHandle,
  profileByHandle,
  userById,
  walletForHandle,
} from "@/lib/server/social-live";
import {holdingsFor} from "@/lib/server/live/holdings";
import {hasDatabase} from "@/lib/server/db";
import {DEMO_MODE} from "@/lib/server/demoMode";
import {connectionsFor, getProfile} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/**
 * Somebody else's profile.
 *
 * Real throughout when the database is configured: the account, both sides of
 * its follow graph, and the holdings read from the wallet it signed in with.
 * Holdings are shown by default; omitted when the owner opted out or has no wallet.
 */
export async function GET(
  request: Request,
  context: {params: Promise<{handle: string}>},
) {
  const params = await context.params;
  if (hasDatabase) {
    const profile = await profileByHandle(params.handle);
    if (profile) {
      const viewerId = await callerId(request);
      let holdingsVisible = await portfolioPublicForHandle(profile.handle);
      if (!holdingsVisible && viewerId) {
        const viewer = await userById(viewerId);
        if (
          viewer?.handle &&
          viewer.handle.toLowerCase() === profile.handle.toLowerCase()
        ) {
          holdingsVisible = true;
        }
      }

      const address = holdingsVisible ? await walletForHandle(profile.handle) : null;

      const [followerHandles, followingHandles, book] = await Promise.all([
        followersOf(profile.handle),
        followingByHandle(profile.handle),
        address && /^0x[0-9a-fA-F]{40}$/.test(address)
          ? holdingsFor(address)
          : Promise.resolve({holdings: [], ethBalance: 0, degraded: false}),
      ]);

      return json({
        profile: {...profile, holdings: book.holdings},
        followerHandles,
        followingHandles,
        holdingsVisible,
        seeded: false,
      });
    }
  }

  // With a database configured, an account that is not in it does not exist —
  // returning a seeded persona would invent the person being looked up.
  if (hasDatabase) return notFound("No profile with that handle.");
  if (!DEMO_MODE) return dataUnavailable();

  const seeded = getProfile(params.handle);
  if (!seeded) return notFound("No profile with that handle.");

  return json({
    profile: seeded,
    followerHandles: connectionsFor(seeded.handle, "followers"),
    followingHandles: connectionsFor(seeded.handle, "following"),
    holdingsVisible: true,
    seeded: true,
  });
}
