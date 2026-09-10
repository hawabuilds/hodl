import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {
  ensureUser,
  savePortfolioPublic,
  saveProfile,
  upsertUser,
  userById,
} from "@/lib/server/social-live";

export const dynamic = "force-dynamic";

/** One users row. The profile header should not wait on balances for this. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  await ensureUser(caller.userId);
  const row = await userById(caller.userId);
  return json(
    row ?? {
      displayName: null,
      handle: null,
      pfpUrl: null,
      wallet: null,
      bio: "",
      portfolioPublic: true,
    },
  );
}

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
    portfolioPublic?: boolean;
  };

  await upsertUser({
    id: caller.userId,
    handle: body.handle ?? null,
    displayName: body.displayName ?? null,
    pfpUrl: body.pfpUrl ?? null,
    wallet: body.wallet ?? null,
  });

  if ("bio" in body || "socials" in body) {
    await saveProfile(caller.userId, {
      displayName: body.displayName ?? null,
      bio: body.bio ?? null,
      socials: body.socials ?? {},
    });
  }

  if (typeof body.portfolioPublic === "boolean") {
    await savePortfolioPublic(caller.userId, body.portfolioPublic);
  }

  return json({ok: true});
}
