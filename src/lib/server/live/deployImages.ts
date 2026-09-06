import {parseAbi} from "viem";
import type {Launchpad} from "@/lib/types";
import {multicallChunked} from "./chain";
import {
  anySocial,
  emptySocials,
  socialsFromMetadata,
  socialsFromPonsInfo,
  type TokenSocials,
} from "./tokenSocials";

/**
 * The picture and socials a creator uploaded when they launched the token.
 *
 * DexScreener's profile photo is preferred when someone has updated it. Until
 * then the launchpad wrote the original art on-chain: Pons as `logo()` /
 * `getTokenInfo()`, Long as `tokenURI()` JSON. Socials live in the same
 * calls — Pons `getTokenInfo()` 5-string tuple, Long `social_links`.
 * Scraping the launchpad page does not work — Pons serves a site-wide OG
 * image, Long returns 403.
 */

const ponsLogoAbi = parseAbi(["function tokenLogo() view returns (string)"]);
const ponsLogoAliasAbi = parseAbi(["function logo() view returns (string)"]);

const ponsInfoAbi = parseAbi([
  "function getTokenInfo() view returns (address, string, string, (string, string, string, string, string))",
]);

const longUriAbi = parseAbi(["function tokenURI() view returns (string)"]);

/**
 * Gateways tried in order. ipfs.io and dweb.link 403 this app's fetches
 * (and often the browser's), so Pinata is first — that is what actually
 * served Long's tokenURI JSON when we measured it.
 */
const IPFS_GATEWAYS = [
  "https://w3s.link/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

/** Gateways that 429 stay skipped for the rest of this process. */
const disabledGates = new Set<string>();

function ipfsPath(uri: string): string | null {
  const value = uri.trim();
  if (value.startsWith("ipfs://")) {
    return value.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  const embedded = value.match(/\/ipfs\/([^?#]+)/);
  if (embedded) return embedded[1];
  if (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(value) ||
    /^baf[a-z0-9]+/i.test(value)
  ) {
    return value;
  }
  return null;
}

export function toHttp(uri: string | null | undefined): string | null {
  const value = uri?.trim();
  if (!value) return null;
  const path = ipfsPath(value);
  if (path) return IPFS_GATEWAYS[0] + path;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  if (value.startsWith("ar://")) return `https://arweave.net/${value.slice(5)}`;
  return null;
}

function imageFromMetadata(body: Record<string, unknown>): string | null {
  // Long writes `image_hash` (their IPFS upload API). Everyone else uses
  // the usual ERC-721 field names. Doppler also nests the CID under `content`.
  for (const key of ["image", "image_url", "image_hash", "imageUrl", "logo"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return toHttp(value);
  }
  const nested = body.content;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    for (const key of ["image", "image_url", "uri", "url"]) {
      const value = inner[key];
      if (typeof value === "string" && value.trim()) return toHttp(value);
    }
  }
  return null;
}

async function fetchViaGateways(path: string): Promise<Response | null> {
  for (const gate of IPFS_GATEWAYS) {
    if (disabledGates.has(gate)) continue;
    try {
      const res = await fetch(gate + path, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: {accept: "application/json,image/*,*/*"},
      });
      if (res.status === 429) {
        disabledGates.add(gate);
        continue;
      }
      if (res.ok) return res;
    } catch {
      // Try the next gateway.
    }
  }
  return null;
}

async function fetchMetadata(uri: string): Promise<{
  image: string | null;
  socials: TokenSocials;
}> {
  const blank = {image: null as string | null, socials: emptySocials()};
  const trimmed = uri.trim();
  if (!trimmed) return blank;

  if (trimmed.startsWith("data:application/json")) {
    try {
      const comma = trimmed.indexOf(",");
      const raw = trimmed.slice(comma + 1);
      const json = trimmed.includes(";base64")
        ? Buffer.from(raw, "base64").toString("utf8")
        : decodeURIComponent(raw);
      const body = JSON.parse(json) as Record<string, unknown>;
      return {image: imageFromMetadata(body), socials: socialsFromMetadata(body)};
    } catch {
      return blank;
    }
  }

  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(trimmed)) {
    return {image: toHttp(trimmed), socials: emptySocials()};
  }

  const path = ipfsPath(trimmed);
  const res = path
    ? await fetchViaGateways(path)
    : await fetch(toHttp(trimmed) ?? trimmed, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: {accept: "application/json,image/*,*/*"},
      }).catch(() => null);

  if (!res?.ok) return blank;
  const type = res.headers.get("content-type") ?? "";
  const url = res.url || toHttp(trimmed);
  if (type.startsWith("image/")) return {image: url, socials: emptySocials()};
  try {
    const body = (await res.json()) as Record<string, unknown>;
    return {image: imageFromMetadata(body), socials: socialsFromMetadata(body)};
  } catch {
    return {image: url, socials: emptySocials()};
  }
}

export type DeployImageHit = {url: string; via: "pons" | "long"};

export type DeployMetaHit = {
  via: "pons" | "long";
  image?: DeployImageHit;
  socials: TokenSocials;
};

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function logoFromInfo(result: unknown): string | null {
  if (!result) return null;
  if (Array.isArray(result)) return pickString(result[1]);
  if (typeof result === "object") {
    const row = result as Record<string, unknown>;
    return pickString(row.tokenLogo, row.logo, row[1]);
  }
  return null;
}

/**
 * Read the creator-uploaded picture and socials from the token itself.
 *
 * Launchpad labels are a hint, not a gate — a Pons row with a null
 * `launchpad` still has `logo()` / `getTokenInfo()`. Tokens with no
 * on-chain URI are left out of the image map so the caller can retry later.
 * Socials are recorded even when every link is empty.
 */
export async function deployMetaFor(
  addresses: string[],
  _launchpads?: Map<string, Launchpad | null>,
): Promise<Map<string, DeployMetaHit>> {
  const out = new Map<string, DeployMetaHit>();
  if (addresses.length === 0) return out;

  const [v2Logos, v1Logos, infos] = await Promise.all([
    multicallChunked<string>(
      addresses.map((address) => ({
        address: address as `0x${string}`,
        abi: ponsLogoAbi,
        functionName: "tokenLogo",
      })),
      "deployImages/ponsLogo",
    ),
    multicallChunked<string>(
      addresses.map((address) => ({
        address: address as `0x${string}`,
        abi: ponsLogoAliasAbi,
        functionName: "logo",
      })),
      "deployImages/ponsLogoAlias",
    ),
    multicallChunked<readonly unknown[]>(
      addresses.map((address) => ({
        address: address as `0x${string}`,
        abi: ponsInfoAbi,
        functionName: "getTokenInfo",
      })),
      "deployImages/ponsInfo",
    ),
  ]);

  const longs: string[] = [];
  addresses.forEach((address, i) => {
    const key = address.toLowerCase();
    const infoOk = infos[i]?.status === "success";
    const logo = pickString(
      v2Logos[i]?.status === "success" ? v2Logos[i].result : null,
      v1Logos[i]?.status === "success" ? v1Logos[i].result : null,
      infoOk ? logoFromInfo(infos[i].result) : null,
    );
    const url = toHttp(logo);
    const socials = infoOk ? socialsFromPonsInfo(infos[i].result) : emptySocials();
    if (url || infoOk) {
      out.set(key, {
        via: "pons",
        image: url ? {url, via: "pons"} : undefined,
        socials,
      });
      return;
    }
    longs.push(address);
  });

  if (longs.length === 0) return out;

  const uris = await multicallChunked<string>(
    longs.map((address) => ({
      address: address as `0x${string}`,
      abi: longUriAbi,
      functionName: "tokenURI",
    })),
    "deployImages/longUri",
  );

  const wanted: {address: string; uri: string}[] = [];
  longs.forEach((address, i) => {
    if (uris[i]?.status !== "success" || !uris[i].result) return;
    wanted.push({address, uri: uris[i].result});
  });

  const CONCURRENCY = 12;
  let index = 0;
  async function worker() {
    while (index < wanted.length) {
      const row = wanted[index++];
      const meta = await fetchMetadata(row.uri);
      if (!meta.image && !anySocial(meta.socials)) continue;
      out.set(row.address.toLowerCase(), {
        via: "long",
        image: meta.image ? {url: meta.image, via: "long"} : undefined,
        socials: meta.socials,
      });
    }
  }
  await Promise.all(
    Array.from({length: Math.min(CONCURRENCY, wanted.length)}, worker),
  );

  return out;
}

export async function deployImagesFor(
  addresses: string[],
  launchpads?: Map<string, Launchpad | null>,
): Promise<Map<string, DeployImageHit>> {
  const out = new Map<string, DeployImageHit>();
  for (const [address, hit] of await deployMetaFor(addresses, launchpads)) {
    if (hit.image) out.set(address, hit.image);
  }
  return out;
}
