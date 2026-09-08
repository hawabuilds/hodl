import {appOrigin} from "../config/appUrl";
import {normalizeAddress} from "./address";
import type {Asset, AssetKind, Timeframe} from "./types";

/**
 * Chart-page URLs.
 *
 * RWAs are addressed by ticker and tokens by contract address, so a link is
 * readable and a pasted address in the search bar resolves to the same page a
 * card links to. `timeframe` becomes `?tf=` so a New-row click opens 1m
 * instead of the generic 1h default.
 */
export function assetPath(
  kind: AssetKind,
  id: string,
  timeframe?: Timeframe | null,
): string {
  const path =
    kind === "rwa" ? `/rwa/${id.toLowerCase()}` : `/token/${normalizeAddress(id)}`;
  return timeframe ? `${path}?tf=${timeframe}` : path;
}

export function assetHref(asset: Asset, timeframe?: Timeframe | null): string {
  return assetPath(asset.kind, asset.id, timeframe);
}

export function profilePath(handle: string): string {
  return `/u/${handle.replace(/^@/, "")}`;
}

/** Absolute public profile URL for share / copy. */
export function profileShareUrl(handle: string): string {
  return `${appOrigin()}${profilePath(handle)}`;
}
