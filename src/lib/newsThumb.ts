import {SUPABASE_URL} from "./env";

/**
 * Resized copies of news artwork, stored once in our own Storage.
 *
 * Publisher images are often 1000px or more and are shown at 52–600px. The
 * news build writes each story's picture at two widths, and the page asks
 * for the stored copy first, falling back to the original while a copy does
 * not exist yet.
 *
 * The stored path is a hash of the original URL, computed the same way here
 * in the browser and on the server, so no database column is needed to find
 * it.
 */

export const NEWS_THUMB_WIDTHS = [240, 720] as const;
export type NewsThumbWidth = (typeof NEWS_THUMB_WIDTHS)[number];

/** FNV-1a, 64-bit, as hex: stable, fast, the same in every runtime. */
export function hashUrl(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The storage path of a resized copy, inside the token-images bucket. */
export function newsThumbPath(imageUrl: string, width: NewsThumbWidth): string {
  return `news/${hashUrl(imageUrl)}/${width}.webp`;
}

/** Public URL of a resized copy, or null for anything that is not a web image URL. */
export function newsThumbUrl(imageUrl: string | null | undefined, width: NewsThumbWidth): string | null {
  if (!imageUrl || !/^https?:\/\//.test(imageUrl) || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/token-images/${newsThumbPath(imageUrl, width)}`;
}
