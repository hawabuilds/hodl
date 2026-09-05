/**
 * Fill null image_url. Keyset on address. No full-table placeholder wipe.
 * Resumable via batch_cursors.
 *
 *   npm run backfill:images
 */
import {db, hasDatabase} from "../src/lib/server/db";
import {persistResolvedImages} from "../src/lib/server/live/tokenImages";
import {runKeysetBatch} from "../src/lib/server/live/keysetBatch";
import type {LaunchpadId} from "../src/lib/universe";

type Row = {address: string; launchpad: string | null};

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const missingStart = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .is("image_url", null);
  if (missingStart.error) throw missingStart.error;

  const result = await runKeysetBatch<Row>({
    name: "backfill:images",
    loadPage: async (after, limit) => {
      let request = db()
        .from("tokens")
        .select("address, launchpad")
        .is("image_url", null)
        .order("address", {ascending: true})
        .limit(limit);
      if (after) request = request.gt("address", after);
      const {data, error} = await request;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    keyOf: (row) => row.address,
    async onPage(page) {
      const wrote = await persistResolvedImages(
        page.map((row) => ({
          address: row.address,
          launchpad: (row.launchpad as LaunchpadId | null) ?? null,
        })),
        {onchainOnly: true},
      );
      return {wrote};
    },
  });

  const missingEnd = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .is("image_url", null);
  if (missingEnd.error) throw missingEnd.error;

  console.log(
    JSON.stringify(
      {
        done: true,
        missingBefore: missingStart.count,
        missingAfter: missingEnd.count,
        resolved: result.extra.wrote ?? 0,
        ...result,
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
