import {json} from "@/lib/server/http";
import {refreshOnchainPrices} from "@/lib/server/live/onchainPrice";
import {pricingCoverage} from "@/lib/server/live/universeStore";
import {NEW_MCAP_COVERAGE_GATE, REQUIRE_MEASURED_MCAP_ON_NEW} from "@/lib/priceState";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  const started = Date.now();
  try {
    const pass = await refreshOnchainPrices({
      hotLimit: 200,
      unpricedLimit: 400,
      budgetMs: 50_000,
    });
    const coverage = await pricingCoverage();
    const crossed = coverage.ratio > NEW_MCAP_COVERAGE_GATE;
    if (crossed && !REQUIRE_MEASURED_MCAP_ON_NEW) {
      console.warn("pricing coverage crossed 90% — New filter still off", coverage);
    }
    return json({
      ...pass,
      coverage,
      requireMeasuredMcapOnNew: REQUIRE_MEASURED_MCAP_ON_NEW,
      gate: NEW_MCAP_COVERAGE_GATE,
      crossed,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error("price cron failed", error);
    return json({error: String(error)}, 500);
  }
}
