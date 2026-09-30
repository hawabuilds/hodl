/**
 * Company logos for every RWA, stored once in our own Storage.
 *
 * Robinhood's `logoUrl` is the same Robinhood feather for every stock token, so
 * it is no use as a company logo. This fetches each logo by ticker from
 * Financial Modeling Prep (free, no key), with a short list of manual fixes
 * where FMP's picture is of a different company, writes 64px and 128px WebP to
 * the public token-images bucket, and records each one's storage path in
 * src/lib/rwaLogos.json — a path, not a URL, so the project URL stays in the
 * env. The app never fetches FMP itself.
 *
 *   npm run backfill:rwa-logos
 *
 * Safe to re-run: uploads overwrite, and the JSON is rewritten whole.
 */
import {writeFileSync} from "node:fs";
import sharp from "sharp";
import registry from "../src/lib/server/rwaRegistry.json" with {type: "json"};
import {db, hasDatabase} from "../src/lib/server/db";
import {ensureBucket, TOKEN_IMAGE_BUCKET} from "../src/lib/server/live/imageCdn";

/** Where FMP's picture is wrong (a ticker reused by another company). */
const MANUAL: Record<string, string> = {
  // FMP and Parqet both still show Fly Leasing, the ticker's old owner.
  FLY: "https://fireflyspace.com/wp-content/uploads/2022/01/cropped-Firefly-Aerospace-Icon-Pantone-389-270x270.png",
  // FMP has a photo of a building for Tower Semiconductor.
  TSEM: "https://assets.parqet.com/logos/symbol/TSEM?format=png",
  // FMP's is an unreadable fund ticket; the SPDR mark is the fund's brand.
  GLD: "https://financialmodelingprep.com/image-stock/SPY.png",
};

const fmp = (ticker: string) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(15_000), headers: {accept: "image/*"}});
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    return body.length > 300 ? body : null;
  } catch {
    return null;
  }
}

/** The dark backdrop for a light logo: the app's raised surface colour. */
const DARK_BACKDROP = "#1A1A24";

/**
 * How light a transparent logo's visible pixels are, 0–255. A white mark on
 * transparency would vanish on a white backdrop, so it gets a dark one.
 */
async function inkLightness(input: Buffer): Promise<number> {
  const {data, info} = await sharp(input).ensureAlpha().resize(64, 64, {fit: "inside"}).raw().toBuffer({resolveWithObject: true});
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.2) continue;
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * alpha;
    weight += alpha;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * A logo on a round avatar. A logo drawn on transparency sits on a plain
 * backdrop with some room around it — white, or dark when the mark itself is
 * light; a logo that is already a filled square is used edge to edge.
 */
async function avatar(input: Buffer, size: number): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const {isOpaque} = await sharp(input).stats();
  if (meta.hasAlpha && !isOpaque) {
    const inner = Math.round(size * 0.72);
    const backdrop = (await inkLightness(input)) > 200 ? DARK_BACKDROP : "#ffffff";
    const logo = await sharp(input).resize(inner, inner, {fit: "contain", background: "#ffffff00"}).png().toBuffer();
    return sharp({create: {width: size, height: size, channels: 4, background: backdrop}})
      .composite([{input: logo, gravity: "centre"}])
      .webp({quality: 88})
      .toBuffer();
  }
  return sharp(input)
    .resize(size, size, {fit: "contain", background: "#ffffff"})
    .flatten({background: "#ffffff"})
    .webp({quality: 88})
    .toBuffer();
}

async function upload(path: string, body: Buffer): Promise<void> {
  const {error} = await db().storage.from(TOKEN_IMAGE_BUCKET).upload(path, body, {
    contentType: "image/webp",
    upsert: true,
    // Short, so a manual fix shows up within the hour.
    cacheControl: "3600",
  });
  if (error) throw new Error(`${path}: ${error.message}`);
}

async function main() {
  if (!hasDatabase) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  await ensureBucket();

  const out: Record<string, {path: string; source: string}> = {};
  const missing: string[] = [];
  const tickers = (registry as {ticker: string}[]).map((entry) => entry.ticker);

  for (const ticker of tickers) {
    const source = MANUAL[ticker] ?? fmp(ticker);
    const raw = await fetchImage(source);
    if (!raw) {
      missing.push(ticker);
      continue;
    }
    const [small, large] = await Promise.all([avatar(raw, 64), avatar(raw, 128)]);
    await Promise.all([upload(`rwa/${ticker}/64.webp`, small), upload(`rwa/${ticker}/128.webp`, large)]);
    out[ticker] = {path: `rwa/${ticker}`, source: MANUAL[ticker] ? "manual" : "fmp"};
  }

  writeFileSync(new URL("../src/lib/rwaLogos.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`stored ${Object.keys(out).length} of ${tickers.length} logos`);
  if (missing.length > 0) console.log(`no logo (letters fallback): ${missing.join(" ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
