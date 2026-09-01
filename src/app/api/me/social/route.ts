import {json} from "@/lib/server/http";
import {connectionsFor, getProfile} from "@/lib/server/social";
import type {Profile} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Who follows the signed-in account.
 *
 * Seeded from the same cast as everything else — there is no follow table yet,
 * and the profile tab labels this as simulated. Following is not returned here:
 * that list is real, and lives in the browser.
 *
 * TODO(live): read both directions from the `follows` table once profiles are
 * stored server-side, keyed on the Privy DID.
 */
export async function GET() {
  const followers = connectionsFor("you", "followers")
    .map((handle) => getProfile(handle))
    .filter((profile): profile is Profile => profile !== null);

  return json({followers, seeded: true});
}
