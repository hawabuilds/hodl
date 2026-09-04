/**
 * Stamp image_source on rows that already have image_url.
 * Safe to rerun. Does not refetch.
 */
import {normalizeAddress} from "../src/lib/address";
import {db, hasDatabase} from "../src/lib/server/db";
import type {ImageSource} from "../src/lib/server/live/universeStore";

function sourceFor(url: string | null, launchpad: string | null): ImageSource | null {
  if (!url) return null;
  if (url.startsWith("data:image")) return "placeholder";
  if (/dexscreener/i.test(url)) return "dexscreener";
  if (launchpad === "pons" || launchpad === "long") return launchpad;
  return "onchain";
}

async function main() {
  if (!hasDatabase) throw new Error("Supabase is not configured");

  let cursor: string | null = null;
  let stamped = 0;

  while (true) {
    let request = db()
      .from("tokens")
      .select("address, launchpad, image_url, image_source")
      .not("image_url", "is", null)
      .is("image_source", null)
      .order("address", {ascending: true})
      .limit(200);
    if (cursor) request = request.gt("address", cursor);

    const {data, error} = await request;
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) break;

    await Promise.all(
      page.map(async (row) => {
        const source = sourceFor(row.image_url, row.launchpad);
        if (!source) return;
        const {error: writeError} = await db()
          .from("tokens")
          .update({image_source: source})
          .eq("address", normalizeAddress(row.address))
          .is("image_source", null);
        if (!writeError) stamped += 1;
      }),
    );

    cursor = String(page[page.length - 1].address);
    console.log(JSON.stringify({stamped, last: cursor}));
    if (page.length < 200) break;
  }

  const {count: missing} = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .is("image_url", null);
  const {data: rows} = await db().from("tokens").select("image_source");
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = String(row.image_source ?? "null");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log({missing, image_source: Object.fromEntries([...counts.entries()].sort())});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
