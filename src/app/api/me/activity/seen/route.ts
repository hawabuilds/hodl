import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {markSeen} from "@/lib/server/following";

export const dynamic = "force-dynamic";

/** Clears the Following count or the bell, up to the newest item the caller saw. */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => ({}))) as {which?: string; at?: string};
  const which = body.which === "following" ? "following" : body.which === "bell" ? "bell" : null;
  if (!which) return badRequest("Which count?");
  const at = typeof body.at === "string" && Number.isFinite(Date.parse(body.at)) ? body.at : null;
  if (!at) return badRequest("Seen up to when?");
  try {
    await markSeen(caller.userId, which, at);
    return json({ok: true});
  } catch (error) {
    console.error("mark seen failed", error);
    return json({error: "Couldn't save."}, 503);
  }
}
