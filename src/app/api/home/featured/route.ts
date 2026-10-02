import {json, publicJson} from "@/lib/server/http";
import {homeFeatured} from "@/lib/server/homeFeatured";

export const dynamic = "force-dynamic";

/** Home's featured RWA and its busiest paired tokens (see homeFeatured.ts). */
export async function GET() {
  try {
    return publicJson(await homeFeatured(), {maxAge: 60, swr: 3600});
  } catch (error) {
    console.error("home featured failed", error);
    return json({error: "Couldn't load the featured RWA."}, 503);
  }
}
