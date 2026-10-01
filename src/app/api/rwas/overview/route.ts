import {json, publicJson} from "@/lib/server/http";
import {cachedPage} from "@/lib/server/live/cache";
import {rwasOverview} from "@/lib/server/rwasBoard";

export const dynamic = "force-dynamic";

/** Top movers, Robinhood's posts and the latest stock news for the RWAs page. */
export async function GET() {
  try {
    return publicJson(await cachedPage("page:rwas-overview", 30_000, rwasOverview), {maxAge: 30, swr: 300});
  } catch (error) {
    console.error("rwas overview failed", error);
    return json({error: "Couldn't load the overview."}, 503);
  }
}
