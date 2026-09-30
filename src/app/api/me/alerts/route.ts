import {cleanAlertPatch} from "@/lib/alerts";
import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {alertPrefsFor, saveAlertPrefs} from "@/lib/server/following";

export const dynamic = "force-dynamic";

/** Settings → Alerts. In-app only: these never send a push or an email. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  try {
    return json({prefs: (await alertPrefsFor(caller.userId)).prefs});
  } catch (error) {
    console.error("alert prefs read failed", error);
    return json({error: "Couldn't load alerts."}, 503);
  }
}

export async function PUT(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const patch = cleanAlertPatch(await request.json().catch(() => null));
  if (Object.keys(patch).length === 0) return badRequest("Nothing to change.");
  try {
    return json({prefs: await saveAlertPrefs(caller.userId, patch)});
  } catch (error) {
    console.error("alert prefs save failed", error);
    return json({error: "Couldn't save."}, 503);
  }
}
