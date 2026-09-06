import type {Launchpad} from "@/lib/types";
import type {LaunchpadId} from "@/lib/universe";
import {isDexRateLimit, noteDex429, pairsForAddresses} from "./dexscreener";
import {tokenImages as geckoImages} from "./geckoterminal";
import {deployMetaFor, toHttp, type DeployMetaHit} from "./deployImages";
import {
  IMAGE_RANK,
  listRecentMissingImages,
  writeTokenImages,
  writeTokenSocials,
  type ImageSource,
} from "./universeStore";
import {
  emptySocials,
  mergeSocials,
  skipDexScreener,
  socialsFromDexPair,
  socialsSourceFor,
  type SocialsSource,
  type TokenSocials,
} from "./tokenSocials";

export type {ImageSource};
export {IMAGE_RANK};
export type {SocialsSource, TokenSocials};

export interface ResolvedImage {
  url: string;
  source: ImageSource;
}

export interface ResolvedSocials extends TokenSocials {
  source: SocialsSource;
}

/**
 * The launchpad's own mark — never a token PFP.
 *
 * Confirmed against Pons and Long pages: the site OG / brand files are shared
 * across every token. Using them makes the New feed look like one logo.
 */
export function isBrandLogo(url: string): boolean {
  return /\/launchpads\/(pons|long)/i.test(url)
    || /pons\.jpg|pons\.png|long\.svg/i.test(url)
    || /ponsfamily\.com\/.*(favicon|og[-_]?image|logo)/i.test(url)
    || /long\.xyz\/.*(favicon|og[-_]?image|logo)/i.test(url);
}

export function usableImageUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  if (value.startsWith("data:image/svg+xml")) return null;
  if (isBrandLogo(value)) return null;
  if (/missing|placeholder|default/i.test(value) && !value.startsWith("data:")) {
    return null;
  }
  return value;
}

function launchpadMeta(
  rows: {address: string; launchpad: LaunchpadId | null}[],
): Map<string, Launchpad | null> {
  const out = new Map<string, Launchpad | null>();
  for (const row of rows) {
    const id = row.launchpad;
    out.set(
      row.address.toLowerCase(),
      id === "pons" || id === "long"
        ? ({id, name: id, color: "", logoUrl: null, url: ""} as Launchpad)
        : null,
    );
  }
  return out;
}

/** Higher-ranked source wins. Dex can replace launchpad; never the reverse. */
export function pickBetterImage(
  current: ResolvedImage | undefined,
  next: ResolvedImage,
): ResolvedImage {
  if (!current) return next;
  return IMAGE_RANK[next.source] > IMAGE_RANK[current.source] ? next : current;
}

function applyLaunchpadHits(
  out: Map<string, ResolvedImage>,
  unique: Map<string, LaunchpadId | null>,
  deploy: Map<string, DeployMetaHit>,
): void {
  for (const [address, hit] of deploy) {
    if (!hit.image) continue;
    const url = usableImageUrl(toHttp(hit.image.url) ?? hit.image.url);
    if (!url) continue;
    const pad = unique.get(address);
    const next: ResolvedImage = {
      url,
      source:
        pad === "pons" || pad === "long"
          ? pad
          : hit.via === "pons"
            ? "pons"
            : "onchain",
    };
    out.set(address, pickBetterImage(out.get(address), next));
  }
}

export interface ResolvedMedia {
  images: Map<string, ResolvedImage>;
  socials: Map<string, ResolvedSocials>;
}

/**
 * Launchpad / on-chain first so a Dex miss or 429 cannot skip brand-new art.
 * Dex then fills gaps and may upgrade via IMAGE_RANK. One Dex
 * `pairsForAddresses` call also fills socials. A miss leaves the row null
 * so a later pass can retry. Generated placeholders are never stored —
 * Avatar paints colour + letter.
 */
export async function resolveMediaFor(
  rows: {address: string; launchpad: LaunchpadId | null}[],
  opts?: {
    onchainOnly?: boolean;
    /** Persist launchpad hits before Dex so New can paint a PFP this poll. */
    onLaunchpadResolved?: (images: Map<string, ResolvedImage>) => Promise<void>;
  },
): Promise<ResolvedMedia> {
  const images = new Map<string, ResolvedImage>();
  const socials = new Map<string, ResolvedSocials>();
  if (rows.length === 0) return {images, socials};

  const unique = new Map<string, LaunchpadId | null>();
  for (const row of rows) {
    unique.set(row.address.toLowerCase(), row.launchpad);
  }
  const addresses = [...unique.keys()];
  const wanted = addresses.map((address) => ({
    address,
    launchpad: unique.get(address) ?? null,
  }));

  const deploy = await deployMetaFor(addresses, launchpadMeta(wanted)).catch(
    () => new Map<string, DeployMetaHit>(),
  );
  applyLaunchpadHits(images, unique, deploy);
  if (opts?.onLaunchpadResolved && images.size > 0) {
    await opts.onLaunchpadResolved(images).catch((error) => {
      console.error("launchpad image persist failed; continuing resolve", error);
    });
  }

  const dexSocials = new Map<string, TokenSocials>();
  const skipDex = skipDexScreener(opts);

  if (!skipDex) {
    try {
      const pairs = await pairsForAddresses(addresses);
      applyDexPairs(pairs, unique, images, dexSocials);
    } catch (error) {
      if (isDexRateLimit(error)) {
        noteDex429();
        // Do not stall insert persist when launchpad already filled the row.
        // A 15s Dex retry here is why New pinned a token before image_url landed.
        if (addresses.some((address) => !images.has(address))) {
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          try {
            const pairs = await pairsForAddresses(addresses);
            applyDexPairs(pairs, unique, images, dexSocials);
          } catch (retryError) {
            if (isDexRateLimit(retryError)) noteDex429();
          }
        }
      }
    }
  }

  for (const address of addresses) {
    const pad = unique.get(address);
    const hit = deploy.get(address);
    const launchSocials = hit?.socials ?? emptySocials();
    const fallback = dexSocials.get(address) ?? emptySocials();
    const merged = mergeSocials(launchSocials, fallback);
    const via =
      hit?.via === "pons" || hit?.via === "long"
        ? hit.via
        : pad === "pons" || pad === "long"
          ? pad
          : null;
    socials.set(address, {
      ...merged,
      source: socialsSourceFor(via, launchSocials, fallback),
    });
  }

  const stillMissing = addresses.filter((address) => !images.has(address));
  if (!opts?.onchainOnly && stillMissing.length > 0) {
    const gecko = await geckoImages(stillMissing).catch(
      () => new Map<string, string>(),
    );
    for (const [address, raw] of gecko) {
      const url = usableImageUrl(raw);
      if (!url || images.has(address)) continue;
      images.set(address, {url, source: "onchain"});
    }
  }

  return {images, socials};
}

function applyDexPairs(
  pairs: Awaited<ReturnType<typeof pairsForAddresses>>,
  unique: Map<string, LaunchpadId | null>,
  images: Map<string, ResolvedImage>,
  dexSocials: Map<string, TokenSocials>,
): void {
  for (const pair of pairs) {
    const url = usableImageUrl(pair.info?.imageUrl);
    const found = socialsFromDexPair(pair);
    for (const raw of [pair.baseToken?.address, pair.quoteToken?.address]) {
      const address = raw?.toLowerCase();
      if (!address || !unique.has(address)) continue;
      if (url) {
        images.set(address, pickBetterImage(images.get(address), {url, source: "dexscreener"}));
      }
      const held = dexSocials.get(address);
      dexSocials.set(address, held ? mergeSocials(held, found) : found);
    }
  }
}

/** Image-only wrapper. Prefer `resolveMediaFor` when socials are needed. */
export async function resolveImagesFor(
  rows: {address: string; launchpad: LaunchpadId | null}[],
  opts?: {onchainOnly?: boolean},
): Promise<Map<string, ResolvedImage>> {
  const {images} = await resolveMediaFor(rows, opts);
  return images;
}

function asWrites(
  rows: Iterable<[string, ResolvedImage]>,
): {address: string; image_url: string; image_source: ImageSource}[] {
  return [...rows]
    .filter(([, image]) => image.source !== "placeholder")
    .map(([address, image]) => ({
      address,
      image_url: image.url,
      image_source: image.source,
    }));
}

export async function persistResolvedMedia(
  rows: {address: string; launchpad: LaunchpadId | null}[],
  opts?: {onchainOnly?: boolean},
): Promise<{images: number; socials: number}> {
  if (rows.length === 0) return {images: 0, socials: 0};
  const resolved = await resolveMediaFor(rows, {
    ...opts,
    onLaunchpadResolved: async (images) => {
      await writeTokenImages(asWrites(images.entries()), {resize: false});
    },
  });
  const socialWrites = rows.map((row) => {
    const hit = resolved.socials.get(row.address.toLowerCase());
    return {
      address: row.address,
      twitter: hit?.x ?? null,
      telegram: hit?.telegram ?? null,
      website: hit?.website ?? null,
      discord: hit?.discord ?? null,
      socials_source: hit?.source ?? null,
    };
  });
  const images = await writeTokenImages(asWrites(resolved.images.entries()), {
    resize: false,
  });
  let socials = 0;
  try {
    socials = await writeTokenSocials(socialWrites);
  } catch (error) {
    console.error("token socials persist failed; images already written", error);
  }
  return {images, socials};
}

/**
 * Resolve and persist artwork and socials from the same Dex / launchpad pass.
 * A miss leaves `image_url` null so a later pass can retry. Socials stamp
 * `socials_checked_at` even when every link is empty.
 */
export async function persistResolvedImages(
  rows: {address: string; launchpad: LaunchpadId | null}[],
  opts?: {onchainOnly?: boolean},
): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const wrote = await persistResolvedMedia(rows, opts);
    return wrote.images;
  } catch (error) {
    // Dex 429 after a launchpad write must not mark persistFailed — the
    // row already has art. A miss still returns 0 so catch-up can retry.
    if (isDexRateLimit(error)) {
      noteDex429();
      console.error("token image Dex 429 after resolve; launchpad write kept", error);
      return 0;
    }
    console.error("token image resolve failed; leaving image_url null", error);
    return 0;
  }
}

/** In-process cooldown so the live-tip catch-up does not hammer Dex every tick. */
export const RECENT_MISSING_IMAGE_RETRY_MS = 10 * 60 * 1000;

const missingImageAttempts = new Map<string, number>();

export function resetMissingImageAttempts(): void {
  missingImageAttempts.clear();
}

export function noteMissingImageAttempt(address: string, now = Date.now()): void {
  missingImageAttempts.set(address.toLowerCase(), now);
}

export function shouldRetryMissingImage(address: string, now = Date.now()): boolean {
  const last = missingImageAttempts.get(address.toLowerCase());
  if (last == null) return true;
  return now - last >= RECENT_MISSING_IMAGE_RETRY_MS;
}

/**
 * Worker-only catch-up: recently listed rows still missing `image_url`.
 * Small newest-first page — not a full backfill. Cron keeps skipImages.
 */
export async function persistRecentMissingImages(): Promise<number> {
  const rows = (await listRecentMissingImages()).filter((row) =>
    shouldRetryMissingImage(row.address),
  );
  if (rows.length === 0) return 0;
  try {
    const wrote = await persistResolvedImages(rows);
    for (const row of rows) noteMissingImageAttempt(row.address);
    if (wrote > 0) {
      console.info(`recent missing-image catch-up wrote ${wrote}`);
    }
    return wrote;
  } catch (error) {
    for (const row of rows) noteMissingImageAttempt(row.address);
    throw error;
  }
}
