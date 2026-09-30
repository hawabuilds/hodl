/**
 * Stored 240px / 720px copies for the pictures of recent stories, so pages
 * show small WebP files from day one instead of waiting for the news build to
 * reach older articles. Safe to re-run: uploads overwrite the same paths.
 *
 *   npm run backfill:news-thumbs
 */
import {db, hasDatabase} from "../src/lib/server/db";
import {storeNewsThumbs} from "../src/lib/server/live/newsThumbs";
import type {FeedItem} from "../src/lib/types";

const DAYS = 14;

async function main() {
  if (!hasDatabase) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const {data, error} = await db()
    .from("news_articles")
    .select("image_url")
    .gte("published_at", since)
    .not("image_url", "is", null)
    .order("published_at", {ascending: false})
    .limit(2000);
  if (error) throw new Error(error.message);
  const urls = [...new Set((data ?? []).map((row) => row.image_url as string))];
  let total = 0;
  // Batches of 30, the news build's own per-build size.
  for (let i = 0; i < urls.length; i += 30) {
    total += await storeNewsThumbs(urls.slice(i, i + 30).map((imageUrl) => ({imageUrl}) as FeedItem));
    console.log(`… ${Math.min(i + 30, urls.length)} of ${urls.length} checked, ${total} stored`);
  }
  console.log(`stored copies for ${total} of ${urls.length} pictures from the last ${DAYS} days`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
