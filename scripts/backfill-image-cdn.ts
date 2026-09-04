/**
 * Resize every existing token PFP into Storage 64/128 WebP + average colour.
 * Rows still pointing at DexScreener / IPFS / Arweave / launchpads get a
 * stored pair; the feed never fetches those origins again.
 *
 * Requires scripts/schema-image-cdn.sql (image_64, image_128, image_color,
 * public token-images bucket).
 *
 *   npm run backfill:image-cdn
 */
import {db, hasDatabase} from "../src/lib/server/db";
import {isStoredImage} from "../src/lib/tokenImage";
import {writeTokenImages, type ImageSource} from "../src/lib/server/live/universeStore";

const PAGE = 80;

function sourceOf(value: string | null | undefined): ImageSource {
  if (value === "dexscreener" || value === "pons" || value === "long" || value === "onchain") {
    return value;
  }
  return "onchain";
}

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  let cursor: string | null = null;
  let scanned = 0;
  let wrote = 0;
  let skipped = 0;

  while (true) {
    let request = db()
      .from("tokens")
      .select("address, image_url, image_source, image_64")
      .not("image_url", "is", null)
      .is("image_64", null)
      .order("address", {ascending: true})
      .limit(PAGE);
    if (cursor) request = request.gt("address", cursor);

    const {data, error} = await request;
    if (error) {
      if (/image_64/i.test(error.message)) {
        throw new Error(
          "tokens.image_64 is missing — run scripts/schema-image-cdn.sql",
        );
      }
      throw error;
    }
    const page = data ?? [];
    if (page.length === 0) break;

    const rows = page
      .map((row) => ({
        address: String(row.address),
        image_url: String(row.image_url ?? ""),
        image_source: sourceOf(row.image_source as string | null),
      }))
      .filter((row) => {
        if (!row.image_url || row.image_url.startsWith("data:image/svg+xml")) {
          skipped += 1;
          return false;
        }
        if (isStoredImage(row.image_url)) {
          skipped += 1;
          return false;
        }
        return true;
      });

    if (rows.length > 0) {
      wrote += await writeTokenImages(rows);
    }

    scanned += page.length;
    cursor = String(page[page.length - 1].address);
    console.log(JSON.stringify({scanned, wrote, skipped, last: cursor}));
    if (page.length < PAGE) break;
  }

  const remaining = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .not("image_url", "is", null)
    .is("image_64", null);
  if (remaining.error) throw remaining.error;

  const stored = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .not("image_64", "is", null);

  console.log({
    scanned,
    wrote,
    skipped,
    stillMissingVariants: remaining.count,
    storedVariants: stored.count,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
