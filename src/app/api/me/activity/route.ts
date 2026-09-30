import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {activityFor} from "@/lib/server/following";

export const dynamic = "force-dynamic";

/**
 * The desktop terminal's Following feed, bell and alert settings in one read,
 * polled on the same clock as the Trending list.
 */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  try {
    return json(await activityFor(caller.userId));
  } catch (error) {
    console.error("activity read failed", error);
    return json({error: "Couldn't load activity."}, 503);
  }
}
