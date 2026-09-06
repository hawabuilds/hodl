/**
 * Walk every known factory from its deploy block to head and fill `tokens`.
 *
 * Resumable: the same cursors the cron uses. Safe to kill and rerun.
 * New launches do not wait for this: each `indexTokens` pass also drains a
 * separate live-tip cursor at head.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-universe.ts
 */
import {ALL_FACTORIES} from "../src/lib/contracts";
import {indexTokens} from "../src/lib/server/live/tokenIndexer";
import {db, hasDatabase} from "../src/lib/server/db";

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  let pass = 0;
  const unresolved = new Set<string>();

  for (const factory of ALL_FACTORIES) {
    // A dedicated Long walker already owns this historical cursor. Live tip
    // still runs inside each Pons pass, so new Long launches are not skipped.
    if (factory.id === "long-airlock") {
      console.log(JSON.stringify({factory: factory.id, skip: "owned by long walker"}));
      continue;
    }
    while (true) {
      pass += 1;
      const result = await indexTokens({
        factoryId: factory.id,
        maxBlocks: 50_000n,
        budgetMs: 0,
        refreshStats: false,
        live: false,
        cursorTimeoutMs: 60_000,
      });
      const hist = result.passes.find((row) => row.factory === factory.id);
      const upserts = hist?.upserts ?? 0;
      for (const address of result.unresolvedRewards) unresolved.add(address);
      const tip = BigInt(result.head);
      const to = hist ? BigInt(hist.to) : 0n;
      console.log(
        JSON.stringify({
          pass,
          factory: factory.id,
          upserts,
          head: result.head,
          to: to.toString(),
          remaining: (tip > to ? tip - to : 0n).toString(),
        }),
      );
      if (!hist || to >= tip) break;
    }
  }

  const statsPass = await indexTokens({
    maxBlocks: 1n,
    budgetMs: 0,
    refreshStats: true,
    live: false,
    cursorTimeoutMs: 60_000,
  });
  console.log(JSON.stringify({stats: statsPass.stats}));

  const {count: total} = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true});
  const {count: rewarded} = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .not("reward_rwa", "is", null);
  const {count: listed} = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("status", "listed");

  console.log({total, listed, rewarded, unresolved: [...unresolved].slice(0, 20)});

  if ((rewarded ?? 0) === 0) {
    console.error(
      "WARN: no token has reward_rwa. ETH/USDG reward routing was not found on-chain.",
    );
    console.error("Sample unresolved:", [...unresolved].slice(0, 10));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
