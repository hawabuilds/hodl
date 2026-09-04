import type {TokenAsset} from "@/lib/types";
import {normalizeAddress} from "@/lib/address";

export interface CachedLogo {
  imageUrl: string | null;
  imageUrl64: string | null;
  imageColor: string | null;
  imageFallbacks: string[];
}

const logos = new Map<string, CachedLogo>();
const loaded = new Map<string, string>();

function keepUrl(next: string | null | undefined, prev: string | null): string | null {
  return next || prev;
}

/** Remember artwork by address. A later payload must not wipe a known URL. */
export function rememberTokenLogos(tokens: TokenAsset[]): void {
  for (const token of tokens) {
    if (token.kind !== "token") continue;
    const address = normalizeAddress(token.address);
    const prev = logos.get(address);
    const fallbacks = token.imageFallbacks ?? [];
    logos.set(address, {
      imageUrl: keepUrl(token.imageUrl, prev?.imageUrl ?? null),
      imageUrl64: keepUrl(token.imageUrl64 ?? null, prev?.imageUrl64 ?? null),
      imageColor: keepUrl(token.imageColor ?? null, prev?.imageColor ?? null),
      imageFallbacks:
        fallbacks.length > 0 ? fallbacks : (prev?.imageFallbacks ?? []),
    });
  }
}

export function logoFor(address: string): CachedLogo | null {
  return logos.get(normalizeAddress(address)) ?? null;
}

export function applyCachedLogo<T extends TokenAsset>(token: T): T {
  const cached = logoFor(token.address);
  const held = loadedLogoFor(token.address);
  if (!cached && !held) return token;
  return {
    ...token,
    imageUrl: token.imageUrl || cached?.imageUrl || held,
    imageUrl64: token.imageUrl64 || cached?.imageUrl64 || null,
    imageColor: token.imageColor || cached?.imageColor || null,
    imageFallbacks:
      token.imageFallbacks && token.imageFallbacks.length > 0
        ? token.imageFallbacks
        : cached?.imageFallbacks ?? [],
  };
}

/** Once a logo has decoded for this address, keep that URL for the session. */
export function rememberLoadedLogo(address: string, url: string): void {
  if (!url) return;
  loaded.set(normalizeAddress(address), url);
}

export function loadedLogoFor(address: string): string | null {
  return loaded.get(normalizeAddress(address)) ?? null;
}

/** Test helper — not used in production paths. */
export function resetTokenLogoCacheForTests(): void {
  logos.clear();
  loaded.clear();
}
