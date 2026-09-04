/**
 * Fill image_url / image_source with real artwork only. Generated SVG
 * placeholders are cleared first, then DexScreener / on-chain / Gecko run
 * against every remaining null. Misses stay null so the next pass can retry.
 *
 *   npm run backfill:images
 */
import {db, hasDatabase} from "../src/lib/server/db";
import {persistResolvedImages} from "../src/lib/server/live/tokenImages";
import {clearGeneratedPlaceholders} from "../src/lib/server/live/universeStore";
import type {LaunchpadId} from "../src/lib/universe";

const PAGE = 100;

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const cleared = await clearGeneratedPlaceholders();
  console.log(JSON.stringify({cleared}));

  let cursor: string | null = null;
  let scanned = 0;
  let wrote = 0;

  while (true) {
    let request = db()
      .from("tokens")
      .select("address, launchpad, image_url, image_source")
      .is("image_url", null)
      .order("address", {ascending: true})
      .limit(PAGE);
    if (cursor) request = request.gt("address", cursor);

    const {data, error} = await request;
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) break;

    wrote += await persistResolvedImages(
      page.map((row) => ({
        address: String(row.address),
        launchpad: (row.launchpad as LaunchpadId | null) ?? null,
      })),
      {onchainOnly: true},
    );

    scanned += page.length;
    cursor = String(page[page.length - 1].address);
    console.log(JSON.stringify({scanned, wrote, last: cursor}));
    if (page.length < PAGE) break;
  }

  const counts = {
    missing: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .is("image_url", null),
    placeholders: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .eq("image_source", "placeholder"),
    dexscreener: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .eq("image_source", "dexscreener"),
    pons: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .eq("image_source", "pons"),
    long: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .eq("image_source", "long"),
    onchain: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .eq("image_source", "onchain"),
    sourceNull: await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .is("image_source", null),
  };
  for (const [key, result] of Object.entries(counts)) {
    if (result.error) throw result.error;
  }
  console.log({
    missing: counts.missing.count,
    placeholders: counts.placeholders.count,
    image_source: {
      dexscreener: counts.dexscreener.count,
      pons: counts.pons.count,
      long: counts.long.count,
      onchain: counts.onchain.count,
      placeholder: counts.placeholders.count,
      null: counts.sourceNull.count,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
