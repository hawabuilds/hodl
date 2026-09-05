/**
 * On-chain price every listed-universe token. Keyset on address.
 * Resumable via batch_cursors. Paste scripts/schema-priced.sql first.
 *
 *   npm run backfill:prices
 */
import {priceTokensBatch, writePricedStats} from "../src/lib/server/live/onchainPrice";
import {listListedForPricing, pricingCoverage} from "../src/lib/server/live/universeStore";
import {hasDatabase} from "../src/lib/server/db";
import {batchPageSize, runKeysetBatch} from "../src/lib/server/live/keysetBatch";
import {NEW_MCAP_COVERAGE_GATE, REQUIRE_MEASURED_MCAP_ON_NEW} from "../src/lib/priceState";
import type {LaunchpadId} from "../src/lib/universe";

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const result = await runKeysetBatch({
    name: "backfill:prices",
    pageSize: batchPageSize(process.env.PRICE_BACKFILL_PAGE ?? process.env.BATCH_PAGE),
    loadPage: (after, limit) => listListedForPricing({afterAddress: after, limit}),
    keyOf: (row) => row.address,
    async onPage(page) {
      const result = await priceTokensBatch(
        page
          .filter((row) => row.launchpad === "pons" || row.launchpad === "long")
          .map((row) => ({
            address: row.address,
            launchpad: row.launchpad as LaunchpadId,
            decimals: row.decimals,
            total_supply: row.total_supply,
            quote_token: row.quote_token,
            quote_kind: row.quote_kind,
          })),
      );
      await writePricedStats(result);
      return {
        priced: result.priced,
        noPool: result.noPool,
        failed: result.failed,
        unevaluated: result.unevaluated,
      };
    },
  });

  let coverage;
  try {
    coverage = await pricingCoverage();
  } catch (error) {
    console.error("coverage query failed", error);
    coverage = null;
  }
  console.log(
    JSON.stringify(
      {
        done: true,
        ...result,
        coverage,
        requireMeasuredMcapOnNew: REQUIRE_MEASURED_MCAP_ON_NEW,
        crossed90: coverage ? coverage.ratio > NEW_MCAP_COVERAGE_GATE : false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
