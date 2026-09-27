import sharp from "sharp";

import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {db, hasDatabase} from "@/lib/server/db";
import {TOKEN_IMAGE_BUCKET, ensureBucket} from "@/lib/server/live/imageCdn";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The picture for a token someone is about to launch.
 *
 * This is the app's first user-writable storage path, so it is deliberately
 * narrow. Signed-in callers only; one fixed size; re-encoded rather than
 * stored as sent. Everything that arrives is decoded by `sharp` and written
 * out as WebP, which means an upload cannot smuggle through an SVG with a
 * script in it, an HTML file wearing a .png name, or a decompression bomb —
 * whatever the bytes claimed to be, what lands in the bucket is an image we
 * produced.
 *
 * The URL is public and permanent once written, because it goes on chain:
 * Pons stores it in the token's `logo` field and Long in its metadata
 * document. A link that later 404s is a token with no picture forever, so
 * this writes to the same bucket the indexer already serves the feed from
 * rather than anywhere more convenient.
 */

/** Generous for a logo, small enough that decoding cannot be used as a DoS. */
const MAX_BYTES = 6 * 1024 * 1024;
/** The bucket's own ceiling — see `ensureBucket` in imageCdn.ts. */
const MAX_STORED_BYTES = 512_000;
const SIZE = 512;

const ACCEPTED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!hasDatabase) return json({error: "Storage is not configured."}, 503);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return json({error: "That upload was not readable."}, 400);
  }

  if (!file) return json({error: "No image was attached."}, 400);
  if (file.size > MAX_BYTES) {
    return json({error: "That image is over 6MB."}, 413);
  }
  // The declared type is a hint, not proof — `sharp` below is what decides.
  if (file.type && !ACCEPTED.has(file.type)) {
    return json({error: "Use a PNG, JPEG, WebP or GIF."}, 415);
  }

  const input = Buffer.from(await file.arrayBuffer());

  /**
   * Re-encode to WebP at one size.
   *
   * An animated GIF keeps its animation, because a token whose picture moves
   * everywhere else should not arrive here as a single frame. That is the one
   * reason to touch `animated`, and it is attempted first: if the animated
   * encode is too heavy for the bucket, a still frame is better than a
   * failed upload, so it falls back rather than erroring.
   *
   * `.rotate()` with no argument applies the EXIF orientation, which is what
   * stops a phone photo arriving on its side.
   */
  async function encode(animated: boolean): Promise<Buffer> {
    return sharp(input, {animated, limitInputPixels: 64_000_000})
      .rotate()
      .resize(SIZE, SIZE, {fit: "cover", position: "centre"})
      .webp({quality: 82, effort: 4})
      .toBuffer();
  }

  let webp: Buffer;
  try {
    const wantsAnimation = file.type === "image/gif" || file.type === "image/webp";
    webp = await encode(wantsAnimation);
    if (wantsAnimation && webp.byteLength > MAX_STORED_BYTES) {
      webp = await encode(false);
    }
  } catch {
    try {
      // A source that claimed to animate but cannot be decoded that way.
      webp = await encode(false);
    } catch {
      return json({error: "That file is not an image we can read."}, 415);
    }
  }

  if (webp.byteLength > MAX_STORED_BYTES) {
    return json({error: "That image is too detailed to store. Try a simpler one."}, 413);
  }

  // Keyed by content, so the same picture uploaded twice costs one object and
  // re-uploading cannot overwrite somebody else's logo.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(webp));
  const key = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const path = `launch/${key}.webp`;

  // The indexer normally creates this; do not assume it has run yet.
  await ensureBucket();

  const {error} = await db()
    .storage.from(TOKEN_IMAGE_BUCKET)
    .upload(path, webp, {
      contentType: "image/webp",
      upsert: true,
      cacheControl: "31536000, immutable",
    });
  if (error) {
    console.error("launch logo upload failed", error.message);
    return json({error: "Couldn't store that image."}, 503);
  }

  const {data} = db().storage.from(TOKEN_IMAGE_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) return json({error: "Couldn't store that image."}, 503);

  return json({url: data.publicUrl});
}
