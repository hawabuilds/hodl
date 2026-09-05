/**
 * REVERT only. Do not hide membership from a pricing miss.
 * eligible = universe membership. price_status = our job.
 * no_pool / failed stay eligible; New hides them via showsOnNew.
 *
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/stamp-unpriceable.ts
 */
import {normalizeAddresses} from "../src/lib/address";
import {db, hasDatabase} from "../src/lib/server/db";
import {pageByAddress, runKeysetBatch} from "../src/lib/server/live/keysetBatch";
import {writeQualifies, type TokenWrite} from "../src/lib/server/live/universeStore";

async function main() {
  if (!hasDatabase) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

  const result = await runKeysetBatch({
    name: "revert:price-eligible",
    loadPage: pageByAddress<{address: string; price_status: string | null}>(
      "token_stats",
      "address, price_status",
    ),
    keyOf: (row) => row.address,
    async onPage(page) {
      const flagged = page.filter(
        (row) => row.price_status === "no_pool" || row.price_status === "failed",
      );
      if (flagged.length === 0) return {reverted: 0};
      const {data, error} = await db()
        .from("tokens")
        .select("address, launchpad, quote_kind, reward_rwa, bonded_at, eligible")
        .in("address", normalizeAddresses(flagged.map((row) => row.address)));
      if (error) throw error;
      const restore = (data ?? []).filter((row) => {
        if (row.eligible !== false) return false;
        const launchpad = row.launchpad as TokenWrite["launchpad"] | null;
        if (launchpad !== "pons" && launchpad !== "long") return false;
        return writeQualifies({
          launchpad,
          quote_kind: row.quote_kind,
          reward_rwa: row.reward_rwa,
          bonded_at: row.bonded_at,
        });
      });
      if (restore.length === 0) return {reverted: 0};
      const {error: err} = await db()
        .from("tokens")
        .update({eligible: true})
        .in("address", normalizeAddresses(restore.map((row) => String(row.address))));
      if (err) throw err;
      return {reverted: restore.length};
    },
  });

  console.log(JSON.stringify({done: true, ...result, extra: result.extra}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
