import {json} from "@/lib/server/http";
import {refreshOnchainPrices} from "@/lib/server/live/onchainPrice";
import {pricingCoverage} from "@/lib/server/live/universeStore";
import {NEW_MCAP_COVERAGE_GATE, REQUIRE_MEASURED_MCAP_ON_NEW} from "@/lib/priceState";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  const started = Date.now();
  try {
    const pass = await refreshOnchainPrices({
      hotLimit: 80,
      unpricedLimit: 80,
      budgetMs: 45_000,
    });
    let coverage = {
      listedEligible: 0,
      measured: 0,
      ratio: 0,
      noPool: 0,
      failed: 0,
    };
    try {
      coverage = await pricingCoverage();
    } catch (error) {
      console.error("price cron coverage failed", error);
    }
    const crossed = coverage.ratio > NEW_MCAP_COVERAGE_GATE;
    if (crossed && !REQUIRE_MEASURED_MCAP_ON_NEW) {
      console.warn("pricing coverage crossed 90% — New filter still off", coverage);
    }
    let notify = {watchlist: 0, holdings: 0, flushed: 0};
    try {
      const {runMilestonePass} = await import("@/lib/server/notifications/milestonesPass");
      const {flushQueuedNotifications} = await import("@/lib/server/notifications/dispatch");
      notify = {
        ...(await runMilestonePass(pass.rows ?? [])),
        flushed: await flushQueuedNotifications(),
      };
    } catch (error) {
      console.error("notification pass failed", error);
    }
    return json({
      ...pass,
      coverage,
      requireMeasuredMcapOnNew: REQUIRE_MEASURED_MCAP_ON_NEW,
      gate: NEW_MCAP_COVERAGE_GATE,
      crossed,
      notify,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error("price cron failed", error);
    return json({error: String(error)}, 500);
  }
}
