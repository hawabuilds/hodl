import type {Launchpad} from "@/lib/types";
import type {LaunchpadId} from "@/lib/universe";
import {pairsForAddresses} from "./dexscreener";
import {tokenImages as geckoImages} from "./geckoterminal";
import {deployImagesFor, toHttp} from "./deployImages";
import {IMAGE_RANK, writeTokenImages, type ImageSource} from "./universeStore";

export type {ImageSource};
export {IMAGE_RANK};

export interface ResolvedImage {
  url: string;
  source: ImageSource;
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

/**
 * The picture the creator uploaded at launch, then Dex / Gecko if that
 * read misses. Every Pons and Long token has on-chain art — DexScreener
 * is decoration, not the source of truth.
 */
export async function resolveImagesFor(
  rows: {address: string; launchpad: LaunchpadId | null}[],
  opts?: {onchainOnly?: boolean},
): Promise<Map<string, ResolvedImage>> {
  const out = new Map<string, ResolvedImage>();
  if (rows.length === 0) return out;

  const unique = new Map<string, LaunchpadId | null>();
  for (const row of rows) {
    unique.set(row.address.toLowerCase(), row.launchpad);
  }
  const addresses = [...unique.keys()];

  const wanted = addresses.map((address) => ({
    address,
    launchpad: unique.get(address) ?? null,
  }));
  const deploy = await deployImagesFor(addresses, launchpadMeta(wanted)).catch(
    () => new Map<string, {url: string; via: "pons" | "long"}>(),
  );
  for (const [address, hit] of deploy) {
    const url = usableImageUrl(toHttp(hit.url) ?? hit.url);
    if (!url) continue;
    const pad = unique.get(address);
    out.set(address, {
      url,
      source:
        pad === "pons" || pad === "long"
          ? pad
          : hit.via === "pons"
            ? "pons"
            : "onchain",
    });
  }

  const missing = addresses.filter((address) => !out.has(address));
  if (opts?.onchainOnly || missing.length === 0) return out;
  {
    const pairs = await pairsForAddresses(missing).catch(() => []);
    for (const pair of pairs) {
      const url = usableImageUrl(pair.info?.imageUrl);
      if (!url) continue;
      const base = pair.baseToken?.address?.toLowerCase();
      if (base && unique.has(base) && !out.has(base)) {
        out.set(base, {url, source: "dexscreener"});
      }
    }
  }

  const stillMissing = addresses.filter((address) => !out.has(address));
  if (stillMissing.length > 0) {
    const gecko = await geckoImages(stillMissing).catch(
      () => new Map<string, string>(),
    );
    for (const [address, raw] of gecko) {
      const url = usableImageUrl(raw);
      if (!url || out.has(address)) continue;
      out.set(address, {url, source: "onchain"});
    }
  }

  return out;
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

/**
 * Resolve and persist only real artwork. On-chain first, then Dex / Gecko.
 * A miss leaves `image_url` null so a later pass can retry.
 */
export async function persistResolvedImages(
  rows: {address: string; launchpad: LaunchpadId | null}[],
  opts?: {onchainOnly?: boolean},
): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const resolved = await resolveImagesFor(rows, opts);
    return writeTokenImages(asWrites(resolved.entries()), {resize: false});
  } catch (error) {
    console.error("token image resolve failed; leaving image_url null", error);
    return 0;
  }
}
