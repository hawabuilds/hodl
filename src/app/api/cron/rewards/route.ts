import {json} from "@/lib/server/http";
import {refreshRewardTotals, scanRewards} from "@/lib/server/live/rewards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One pass of the reward detector.
 *
 * Guarded by the shared secret: without it anyone could trigger the scan and
 * burn the public RPC's goodwill on your behalf.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  try {
    const scan = await scanRewards();
    const tokens = await refreshRewardTotals();
    return json({...scan, tokensUpdated: tokens});
  } catch (error) {
    console.error("reward scan failed", error);
    return json({error: String(error)}, 500);
  }
}
