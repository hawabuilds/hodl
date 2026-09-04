import type {TokenAsset} from "@/lib/types";
import {normalizeAddress} from "@/lib/address";
import {
  applyCachedLogo,
  rememberTokenLogos,
  resetTokenLogoCacheForTests,
} from "@/lib/tokenLogoCache";

/**
 * One TokenAsset per address, shared by every view.
 *
 * Home, New, Search, Watchlist, Portfolio and the chart page all read this.
 * Views differ in which addresses they show — never in the token itself.
 * A later decorate miss cannot wipe a stored image_url.
 */

const rows = new Map<string, TokenAsset>();

export function mergeTokenRow(
  prev: TokenAsset | undefined,
  next: TokenAsset,
): TokenAsset {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    imageUrl: next.imageUrl || prev.imageUrl,
    imageUrl64: next.imageUrl64 || prev.imageUrl64,
    imageColor: next.imageColor || prev.imageColor,
    imageFallbacks:
      next.imageFallbacks && next.imageFallbacks.length > 0
        ? next.imageFallbacks
        : prev.imageFallbacks,
  };
}

/** Seed the per-address cache. A miss in a later payload keeps the known logo. */
export function rememberTokens(assets: TokenAsset[]): void {
  rememberTokenLogos(assets);
  for (const asset of assets) {
    if (asset.kind !== "token") continue;
    const address = normalizeAddress(asset.address);
    rows.set(address, mergeTokenRow(rows.get(address), asset));
  }
}

export function tokenFor(address: string): TokenAsset | null {
  return rows.get(normalizeAddress(address)) ?? null;
}

export function applyCachedToken<T extends TokenAsset>(token: T): T {
  const held = tokenFor(token.address);
  return applyCachedLogo(mergeTokenRow(held ?? undefined, token)) as T;
}

export function applyCachedAssets<T extends {kind: string}>(assets: T[]): T[] {
  return assets.map((asset) =>
    asset.kind === "token"
      ? (applyCachedToken(asset as unknown as TokenAsset) as unknown as T)
      : asset,
  );
}

export function resetTokenCacheForTests(): void {
  rows.clear();
  resetTokenLogoCacheForTests();
}
