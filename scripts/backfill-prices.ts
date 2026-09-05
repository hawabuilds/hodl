/**
 * On-chain price every listed-universe token. Keyset on address via
 * DATABASE_URL + pg (statement_timeout=0). Resumable via batch_cursors.
 *
 *   npm run backfill:prices
 */
import {
  connectAdmin,
  listListedForPricing,
  pricingCoverage,
  readBatchCursor,
  writeBatchCursor,
} from "../src/lib/server/live/adminCatalogue";
import {priceTokensBatch, writePricedStats} from "../src/lib/server/live/onchainPrice";
import {batchPageSize, runKeysetBatch} from "../src/lib/server/live/keysetBatch";
import {NEW_MCAP_COVERAGE_GATE, REQUIRE_MEASURED_MCAP_ON_NEW} from "../src/lib/priceState";
import type {LaunchpadId} from "../src/lib/universe";

function redact(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]");
}

async function main() {
  const admin = await connectAdmin();
  try {
    const result = await runKeysetBatch({
      name: "backfill:prices",
      pageSize: batchPageSize(process.env.PRICE_BACKFILL_PAGE ?? process.env.BATCH_PAGE),
      readCursor: (name) => readBatchCursor(admin, name),
      writeCursor: (name, lastKey, scanned) => writeBatchCursor(admin, name, lastKey, scanned),
      continueOnPageError: true,
      loadPage: (after, limit) =>
        listListedForPricing(admin, {
          afterAddress: after,
          limit,
          onlyUnpriced: true,
        }),
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
      coverage = await pricingCoverage(admin);
    } catch (error) {
      console.error("coverage query failed", error instanceof Error ? redact(error.message) : error);
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
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? redact(error.message) : error);
  process.exit(1);
});
