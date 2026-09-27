import sharp from "sharp";
import {db, hasDatabase} from "../db";
import {isStoredImage} from "@/lib/tokenImage";
import {toHttp} from "./deployImages";

export const TOKEN_IMAGE_BUCKET = "token-images";

export interface StoredTokenImage {
  image_64: string;
  image_128: string;
  image_color: string;
}

let bucketReady: Promise<void> | null = null;

export async function ensureBucket(): Promise<void> {
  if (!hasDatabase) return;
  const {data, error} = await db().storage.listBuckets();
  if (error) {
    console.error("token-images bucket list failed", error.message);
    return;
  }
  if (data?.some((bucket) => bucket.name === TOKEN_IMAGE_BUCKET)) return;
  const created = await db().storage.createBucket(TOKEN_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: 512_000,
    allowedMimeTypes: ["image/webp"],
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    console.error("token-images bucket create failed", created.error.message);
  }
}

function readyBucket(): Promise<void> {
  bucketReady ??= ensureBucket();
  return bucketReady;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")}`;
}

async function averageColor(buffer: Buffer): Promise<string> {
  const stats = await sharp(buffer).stats();
  const r = stats.channels[0]?.mean ?? 0;
  const g = stats.channels[1]?.mean ?? r;
  const b = stats.channels[2]?.mean ?? r;
  return toHex(r, g, b);
}

async function squareWebp(input: Buffer, size: number): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(size, size, {fit: "cover", position: "centre"})
    .webp({quality: 82, effort: 4})
    .toBuffer();
}

async function fetchRemote(url: string): Promise<Buffer | null> {
  if (url.startsWith("data:image/") && !url.startsWith("data:image/svg+xml")) {
    const comma = url.indexOf(",");
    if (comma < 0) return null;
    return Buffer.from(url.slice(comma + 1), url.includes(";base64") ? "base64" : "utf8");
  }
  const http = toHttp(url) ?? url;
  try {
    const res = await fetch(http, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {accept: "image/*,*/*"},
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function uploadWebp(path: string, body: Buffer): Promise<string | null> {
  const {error} = await db().storage.from(TOKEN_IMAGE_BUCKET).upload(path, body, {
    contentType: "image/webp",
    upsert: true,
    cacheControl: "31536000, immutable",
  });
  if (error) {
    console.error("token image upload failed", path, error.message);
    return null;
  }
  const {data} = db().storage.from(TOKEN_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl || null;
}

/**
 * Fetch a remote PFP once, write 64px and 128px WebP to Storage, and return
 * those URLs plus the average colour. The feed never fetches the source again.
 */
export async function storeTokenImage(
  address: string,
  remoteUrl: string,
): Promise<StoredTokenImage | null> {
  if (!hasDatabase) return null;
  if (isStoredImage(remoteUrl)) return null;

  await readyBucket();
  const raw = await fetchRemote(remoteUrl);
  if (!raw || raw.length < 32) return null;

  let small: Buffer;
  let large: Buffer;
  try {
    [small, large] = await Promise.all([
      squareWebp(raw, 64),
      squareWebp(raw, 128),
    ]);
  } catch (error) {
    console.error("token image resize failed", address, error);
    return null;
  }

  const key = address.toLowerCase();
  const [url64, url128, color] = await Promise.all([
    uploadWebp(`${key}/64.webp`, small),
    uploadWebp(`${key}/128.webp`, large),
    averageColor(small),
  ]);
  if (!url64 || !url128) return null;
  return {image_64: url64, image_128: url128, image_color: color};
}

export async function storeTokenImages(
  rows: {address: string; url: string}[],
  concurrency = 6,
): Promise<Map<string, StoredTokenImage>> {
  const out = new Map<string, StoredTokenImage>();
  if (rows.length === 0) return out;
  let index = 0;
  async function worker() {
    while (index < rows.length) {
      const row = rows[index++];
      const stored = await storeTokenImage(row.address, row.url);
      if (stored) out.set(row.address.toLowerCase(), stored);
    }
  }
  await Promise.all(
    Array.from({length: Math.min(concurrency, rows.length)}, worker),
  );
  return out;
}
