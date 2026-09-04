/**
 * On-chain price every listed eligible token. Multicall3, hundreds of pools
 * per call. Prints throughput / minute and coverage after the pass.
 *
 *   npm run backfill:prices
 *
 * Paste scripts/schema-priced.sql first so priced_at / price_status persist.
 * Safe to re-run — already-priced rows are refreshed.
 */
import {priceTokensBatch, writePricedStats} from "../src/lib/server/live/onchainPrice";
import {
  listListedForPricing,
  listNewestListed,
  pricingCoverage,
  statsFor,
} from "../src/lib/server/live/universeStore";
import {hasDatabase} from "../src/lib/server/db";
import {NEW_MCAP_COVERAGE_GATE, REQUIRE_MEASURED_MCAP_ON_NEW} from "../src/lib/priceState";
import type {LaunchpadId} from "../src/lib/universe";

const PAGE = Number(process.env.PRICE_BACKFILL_PAGE || 200);
const LIMIT = Number(process.env.PRICE_BACKFILL_LIMIT || 0);
const AFTER = (process.env.PRICE_BACKFILL_AFTER || "").trim().toLowerCase() || null;

function isTimeout(error: unknown): boolean {
  const code = (error as {code?: string} | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "57014" || /statement timeout/i.test(message);
}

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const started = Date.now();
  let after: string | null = AFTER;
  let scanned = 0;
  let priced = 0;
  let noPool = 0;
  let failed = 0;
  let unevaluated = 0;
  const minuteMarks: {at: number; scanned: number}[] = [{at: started, scanned: 0}];
  if (AFTER) {
    console.log(JSON.stringify({phase: "resume", after: AFTER, page: PAGE}));
  }

  const newest = AFTER ? [] : await listNewestListed(PAGE);
  if (newest.length > 0) {
    const held = await statsFor(newest.map((row) => row.address));
    const result = await priceTokensBatch(
      newest
        .filter((row) => row.launchpad === "pons" || row.launchpad === "long")
        .map((row) => ({
          address: row.address,
          launchpad: row.launchpad as LaunchpadId,
          decimals: row.decimals,
          total_supply: row.total_supply,
          quote_token: row.quote_token,
          quote_kind: row.quote_kind,
        })),
      held,
    );
    await writePricedStats(result);
    scanned += newest.length;
    priced += result.priced;
    noPool += result.noPool;
    failed += result.failed;
    unevaluated += result.unevaluated;
    console.log(JSON.stringify({phase: "newest", scanned, priced, noPool, failed, unevaluated}));
    if (LIMIT > 0 && scanned >= LIMIT) {
      after = "done";
    }
  }

  for (;;) {
    if (after === "done") break;
    let page;
    try {
      page = await listListedForPricing({afterAddress: after, limit: PAGE});
    } catch (error) {
      if (!isTimeout(error)) throw error;
      console.error(JSON.stringify({retry: true, reason: "list timeout", after}));
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      continue;
    }
    if (page.length === 0) break;
    try {
      const held = await statsFor(page.map((row) => row.address));
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
        held,
      );
      await writePricedStats(result);
      after = page[page.length - 1]!.address;
      scanned += page.length;
      priced += result.priced;
      noPool += result.noPool;
      failed += result.failed;
      unevaluated += result.unevaluated;
      const elapsed = Date.now() - started;
      const perMin = elapsed > 0 ? scanned / (elapsed / 60_000) : 0;
      minuteMarks.push({at: Date.now(), scanned});
      console.log(
        JSON.stringify({
          scanned,
          priced,
          noPool,
          failed,
          unevaluated,
          tokensPerMin: Math.round(perMin),
          last: after,
        }),
      );
    } catch (error) {
      if (!isTimeout(error)) throw error;
      console.error(JSON.stringify({retry: true, reason: "write timeout", after}));
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      continue;
    }
    if (LIMIT > 0 && scanned >= LIMIT) break;
  }

  const elapsed = Date.now() - started;
  let coverage = {
    listedEligible: scanned,
    measured: priced,
    ratio: scanned > 0 ? priced / scanned : 0,
    noPool,
    failed,
  };
  try {
    coverage = await pricingCoverage();
    if (coverage.measured === 0 && priced > 0) {
      coverage = {
        listedEligible: scanned,
        measured: priced,
        ratio: scanned > 0 ? priced / scanned : 0,
        noPool,
        failed,
      };
    }
  } catch (error) {
    console.error("coverage query failed; using pass counts", error);
  }
  const report = {
    scanned,
    priced,
    noPool,
    failed,
    unevaluated,
    ms: elapsed,
    tokensPerMin: elapsed > 0 ? Math.round(scanned / (elapsed / 60_000)) : 0,
    coverage,
    requireMeasuredMcapOnNew: REQUIRE_MEASURED_MCAP_ON_NEW,
    crossed90: coverage.ratio > NEW_MCAP_COVERAGE_GATE,
  };
  console.log(JSON.stringify({done: report}, null, 2));
  if (report.crossed90 && !REQUIRE_MEASURED_MCAP_ON_NEW) {
    console.warn(
      `Coverage is ${(coverage.ratio * 100).toFixed(1)}% — above 90%. New filter is still OFF. Flip REQUIRE_MEASURED_MCAP_ON_NEW after you confirm.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
