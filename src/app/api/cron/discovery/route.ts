import {json} from "@/lib/server/http";
import {allRwaPairs, quotePairsFromMegafilter} from "@/lib/server/live/dexscreener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Warms the Gecko-backed discovery caches before user traffic hits a cold
 * instance.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  try {
    const [rwa, quote] = await Promise.all([
      allRwaPairs(),
      quotePairsFromMegafilter(),
    ]);
    return json({rwaPairs: rwa.length, quotePairs: quote.length});
  } catch (error) {
    console.error("discovery warm failed", error);
    return json({error: String(error)}, 500);
  }
}
