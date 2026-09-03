import {json} from "@/lib/server/http";
import {callerId} from "@/lib/server/auth";
import {hasDatabase} from "@/lib/server/db";
import {followersOfId, profilesByHandles} from "@/lib/server/social-live";
import {connectionsFor, getProfile} from "@/lib/server/social";
import type {Profile} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Who follows the signed-in account.
 *
 * Read from the follow table rather than the seeded cast, keyed on the id in
 * the caller's token. An unauthenticated request gets an empty list, which is
 * the truthful answer to "who follows you" when nobody is signed in.
 */
export async function GET(request: Request) {
  const userId = await callerId(request);

  if (hasDatabase && userId) {
    const handles = await followersOfId(userId);
    const followers = await profilesByHandles(handles);
    return json({followers, seeded: false});
  }

  if (hasDatabase) return json({followers: [], seeded: false});

  const followers = connectionsFor("you", "followers")
    .map((handle) => getProfile(handle))
    .filter((profile): profile is Profile => profile !== null);

  return json({followers, seeded: true});
}
