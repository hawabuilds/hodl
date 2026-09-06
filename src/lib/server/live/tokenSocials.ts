import type {SocialLinks} from "@/lib/types";
import type {DexPair} from "./dexscreener";
import {socialsFrom} from "./dexscreener";

/** Where the stored socials primarily came from. Mixed → launchpad. */
export type SocialsSource = "pons" | "long" | "dexscreener" | "onchain" | null;

export type TokenSocials = SocialLinks;

export function emptySocials(): TokenSocials {
  return {x: null, telegram: null, website: null, discord: null};
}

export function anySocial(socials: TokenSocials | null | undefined): boolean {
  if (!socials) return false;
  return Boolean(socials.x || socials.telegram || socials.website || socials.discord);
}

export function asSocialUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  return null;
}

export function classifySocialUrl(
  url: string,
): keyof TokenSocials {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (
      host === "x.com" ||
      host === "twitter.com" ||
      host === "mobile.twitter.com" ||
      host.endsWith(".x.com") ||
      host.endsWith(".twitter.com")
    ) {
      return "x";
    }
    if (
      host === "t.me" ||
      host === "telegram.me" ||
      host === "telegram.dog" ||
      host.endsWith(".t.me") ||
      host === "telegram.org"
    ) {
      return "telegram";
    }
    if (
      host === "discord.gg" ||
      host === "discord.com" ||
      host === "discordapp.com" ||
      host.endsWith(".discord.com") ||
      host.endsWith(".discord.gg")
    ) {
      return "discord";
    }
  } catch {
    // Fall through to website.
  }
  return "website";
}

function collectUrls(socials: TokenSocials, urls: Array<string | null>): TokenSocials {
  const out = {...socials};
  for (const url of urls) {
    if (!url) continue;
    const kind = classifySocialUrl(url);
    if (!out[kind]) out[kind] = url;
  }
  return out;
}

/**
 * Pons `getTokenInfo()` 5-string tuple, measured on listed tokens:
 * [twitter, telegram, discord, website, extra]. Creators often put an
 * X URL in the website slot — classify by host so that still lands on X.
 */
export function socialsFromPonsTuple(tuple: unknown): TokenSocials {
  const slots = Array.isArray(tuple) ? tuple : [];
  return collectUrls(
    emptySocials(),
    slots.slice(0, 5).map((slot) => asSocialUrl(slot)),
  );
}

export function socialsFromPonsInfo(result: unknown): TokenSocials {
  if (!result) return emptySocials();
  if (Array.isArray(result)) return socialsFromPonsTuple(result[3]);
  if (typeof result === "object") {
    const row = result as Record<string, unknown>;
    return socialsFromPonsTuple(row[3] ?? row.socials);
  }
  return emptySocials();
}

function labelKind(label: unknown): keyof TokenSocials | null {
  if (typeof label !== "string") return null;
  const value = label.trim().toLowerCase();
  if (value === "x" || value === "twitter") return "x";
  if (value === "telegram" || value === "tg") return "telegram";
  if (value === "discord") return "discord";
  if (value === "website" || value === "web" || value === "site") return "website";
  return null;
}

/**
 * Long `tokenURI` JSON `social_links: {label, url}[]`.
 * Labels are not trustworthy — "Website" often wraps an x.com URL.
 */
export function socialsFromLongLinks(links: unknown): TokenSocials {
  const out = emptySocials();
  if (!Array.isArray(links)) return out;
  for (const entry of links) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {label?: unknown; url?: unknown};
    const url = asSocialUrl(row.url);
    if (!url) continue;
    const kind = classifySocialUrl(url) || labelKind(row.label) || "website";
    if (!out[kind]) out[kind] = url;
  }
  return out;
}

export function socialsFromMetadata(body: Record<string, unknown>): TokenSocials {
  const fromLinks = socialsFromLongLinks(body.social_links ?? body.socials ?? body.links);
  return collectUrls(fromLinks, [
    asSocialUrl(body.twitter) ?? asSocialUrl(body.x),
    asSocialUrl(body.telegram),
    asSocialUrl(body.discord),
    asSocialUrl(body.website) ?? asSocialUrl(body.external_url) ?? asSocialUrl(body.externalUrl),
  ]);
}

export function socialsFromDexPair(pair: DexPair): TokenSocials {
  return socialsFrom(pair);
}

/** Per-field merge: primary wins when set; fallback fills gaps. Never blanks a set field. */
export function mergeSocials(
  primary: TokenSocials | null | undefined,
  fallback: TokenSocials | null | undefined,
): TokenSocials {
  const a = primary ?? emptySocials();
  const b = fallback ?? emptySocials();
  return {
    x: a.x || b.x || null,
    telegram: a.telegram || b.telegram || null,
    website: a.website || b.website || null,
    discord: a.discord || b.discord || null,
  };
}

export function socialsSourceFor(
  launchpad: "pons" | "long" | null,
  launchpadSocials: TokenSocials,
  dexSocials: TokenSocials,
): SocialsSource {
  const fromPad = anySocial(launchpadSocials);
  const fromDex = anySocial(dexSocials);
  if (fromPad && (launchpad === "pons" || launchpad === "long")) return launchpad;
  if (fromPad) return "onchain";
  if (fromDex) return "dexscreener";
  return null;
}

/**
 * Dex is skipped in local development so stored / launchpad socials still
 * render. Set SKIP_DEXSCREENER=0 to force Dex locally.
 */
export function skipDexScreener(opts?: {onchainOnly?: boolean}): boolean {
  if (opts?.onchainOnly) return true;
  const flag = process.env.SKIP_DEXSCREENER?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  // Railway workers often inherit NODE_ENV=development from a linked
  // local profile. The live-tip service must still try Dex.
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME) {
    return false;
  }
  return process.env.NODE_ENV === "development";
}
