import sharp from "sharp";

import {NEWS_THUMB_WIDTHS, newsThumbPath} from "@/lib/newsThumb";
import type {FeedItem} from "@/lib/types";
import {db, hasDatabase} from "../db";
import {readyBucket, TOKEN_IMAGE_BUCKET} from "./imageCdn";

/**
 * Resized copies of news artwork (see src/lib/newsThumb.ts), written by the
 * news build — which already runs behind a served copy — never by a reader.
 */

/** New pictures handled per build, and at most this long spent on them. */
const PER_BUILD = 30;
const BUDGET_MS = 20_000;
const CONCURRENCY = 4;

/** Originals already copied (or found unusable) by this process. */
const done = new Set<string>();

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {accept: "image/*", "user-agent": "Mozilla/5.0 (compatible; HODL news thumbnails)"},
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    return body.length > 500 && body.length < 15_000_000 ? body : null;
  } catch {
    return null;
  }
}

/** True when both copies were written; false when the original could not be read. */
async function storeOne(imageUrl: string): Promise<boolean> {
  const raw = await fetchImage(imageUrl);
  if (!raw) return false;
  await Promise.all(
    NEWS_THUMB_WIDTHS.map(async (width) => {
      const body = await sharp(raw)
        .rotate()
        .resize({width, withoutEnlargement: true})
        .webp({quality: 78, effort: 4})
        .toBuffer();
      const {error} = await db()
        .storage.from(TOKEN_IMAGE_BUCKET)
        .upload(newsThumbPath(imageUrl, width), body, {
          contentType: "image/webp",
          upsert: true,
          // The path is a hash of the original, so a copy never changes.
          cacheControl: "31536000, immutable",
        });
      if (error) throw new Error(error.message);
    }),
  );
  return true;
}

/** Copy the newest stories' pictures that this process has not copied yet. */
export async function storeNewsThumbs(items: readonly FeedItem[]): Promise<number> {
  if (!hasDatabase) return 0;
  const queue = [
    ...new Set(
      items
        .map((item) => item.imageUrl)
        .filter((url): url is string => Boolean(url && /^https?:\/\//.test(url) && !done.has(url))),
    ),
  ].slice(0, PER_BUILD);
  if (queue.length === 0) return 0;
  await readyBucket();
  const started = Date.now();
  let stored = 0;
  const worker = async () => {
    while (queue.length > 0 && Date.now() - started < BUDGET_MS) {
      const url = queue.shift()!;
      done.add(url);
      try {
        if (await storeOne(url)) stored += 1;
      } catch (error) {
        console.warn("news thumb failed", error instanceof Error ? error.message : error);
      }
    }
  };
  await Promise.all(Array.from({length: CONCURRENCY}, worker));
  return stored;
}
