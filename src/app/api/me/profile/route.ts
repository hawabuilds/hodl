import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {saveProfile, upsertUser} from "@/lib/server/social-live";

export const dynamic = "force-dynamic";

/**
 * Creates the caller's row on first write, then applies the edit.
 *
 * Handle, avatar and wallet come from the login identity rather than the body —
 * they are facts about the account, not fields someone gets to set.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as {
    handle?: string | null;
    displayName?: string | null;
    pfpUrl?: string | null;
    wallet?: string | null;
    bio?: string | null;
    socials?: unknown;
  };

  await upsertUser({
    id: caller.userId,
    handle: body.handle ?? null,
    displayName: body.displayName ?? null,
    pfpUrl: body.pfpUrl ?? null,
    wallet: body.wallet ?? null,
  });

  await saveProfile(caller.userId, {
    displayName: body.displayName ?? null,
    bio: body.bio ?? null,
    socials: body.socials ?? {},
  });

  return json({ok: true});
}
