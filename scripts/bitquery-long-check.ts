/**
 * Bitquery Airlock Create count + 20 on-chain spot checks.
 * Does not crawl getLogs. Does not ingest.
 *
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/bitquery-long-check.ts
 */
import {parseAbi} from "viem";
import {LONG_AIRLOCK_FACTORY} from "../src/lib/contracts";
import {countCreates, pageCreates} from "../src/lib/server/live/bitquery";
import {rpc} from "../src/lib/server/live/chain";

const airlockAbi = parseAbi([
  "function getAssetData(address) view returns (address numeraire, address timelock, address governance, address liquidityMigrator, address poolInitializer, address pool)",
]);

async function main() {
  const airlock = LONG_AIRLOCK_FACTORY.address;
  const counted = await countCreates(airlock, "Create");
  const page = await pageCreates(airlock, "Create", 0, 20);
  const samples = [];
  for (const hit of page.hits.slice(0, 20)) {
    try {
      const data = await rpc().readContract({
        address: airlock,
        abi: airlockAbi,
        functionName: "getAssetData",
        args: [hit.address as `0x${string}`],
      });
      const row = Array.isArray(data) ? data : null;
      samples.push({
        address: hit.address,
        block: hit.block,
        numeraire: row ? String(row[0]) : null,
        pool: row ? String(row[5]) : null,
      });
    } catch (error) {
      samples.push({
        address: hit.address,
        block: hit.block,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        airlock,
        bitqueryCreates: counted.count,
        points: counted.points,
        pageHits: page.hits.length,
        samples,
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
