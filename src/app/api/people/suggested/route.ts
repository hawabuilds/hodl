import {json, publicJson} from "@/lib/server/http";
import {suggestedTraders} from "@/lib/server/suggestedTraders";

export const dynamic = "force-dynamic";

/** The most active traders on HODL, for "People to follow". */
export async function GET() {
  try {
    return publicJson({people: await suggestedTraders()}, {maxAge: 60, swr: 3600});
  } catch (error) {
    console.error("suggested traders failed", error);
    return json({people: []}, 503);
  }
}
