import {json} from "@/lib/server/http";
import {refreshRewardTotals, scanRewards} from "@/lib/server/live/rewards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bounded, resumable payout scan plus a light 24h total rollup.
 *
 * Guarded by the shared secret: without it anyone could trigger the scan and
 * burn the public RPC's goodwill on your behalf. Writes only the token rows
 * whose `rewards_24h_usd` actually moved — prices and live-gap own the rest.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  const started = Date.now();
  try {
    const scan = await scanRewards();
    const totals = await refreshRewardTotals();
    const ms = Date.now() - started;
    console.info(
      `reward scan from=${scan.scanned.from} to=${scan.scanned.to} dists=${scan.distributions} tokensUpdated=${totals.tokensUpdated} remaining=${totals.remaining} ms=${ms}`,
    );
    return json({...scan, ...totals, ms});
  } catch (error) {
    console.error("reward scan failed", error);
    return json({error: String(error)}, 500);
  }
}
