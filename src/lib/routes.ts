import {normalizeAddress} from "./address";
import type {Asset, AssetKind} from "./types";

/**
 * Chart-page URLs.
 *
 * RWAs are addressed by ticker and tokens by contract address, so a link is
 * readable and a pasted address in the search bar resolves to the same page a
 * card links to.
 */
export function assetPath(kind: AssetKind, id: string): string {
  return kind === "rwa" ? `/rwa/${id.toLowerCase()}` : `/token/${normalizeAddress(id)}`;
}

export function assetHref(asset: Asset): string {
  return assetPath(asset.kind, asset.id);
}

export function profilePath(handle: string): string {
  return `/u/${handle.replace(/^@/, "")}`;
}
