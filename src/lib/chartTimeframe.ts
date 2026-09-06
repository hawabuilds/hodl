import type {AssetKind, Timeframe} from "./types";
import {RWA_TIMEFRAMES, TIMEFRAMES} from "./types";

/**
 * Fresh enough that a 1D (or even 1h) chart is mostly empty space.
 * New-tab rows always pass `?tf=1m`; this also covers a refresh or a
 * shared URL that omitted the interval.
 */
export const YOUNG_LISTING_MS = 24 * 60 * 60 * 1000;

export function parseRequestedTimeframe(
  value: string | null | undefined,
  kind: AssetKind,
): Timeframe | null {
  if (!value) return null;
  const options: readonly string[] = kind === "rwa" ? RWA_TIMEFRAMES : TIMEFRAMES;
  return options.includes(value) ? (value as Timeframe) : null;
}

export function isYoungListing(
  listedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!listedAt) return false;
  const listed = Date.parse(listedAt);
  if (!Number.isFinite(listed)) return false;
  const age = now - listed;
  return age >= 0 && age < YOUNG_LISTING_MS;
}

/** First-paint interval: URL wins, then a young listing, otherwise 1h. */
export function defaultChartTimeframe(input: {
  kind: AssetKind;
  listedAt?: string | null;
  requested?: string | null;
  now?: number;
}): Timeframe {
  const fromUrl = parseRequestedTimeframe(input.requested, input.kind);
  if (fromUrl) return fromUrl;
  if (input.kind === "token" && isYoungListing(input.listedAt, input.now)) {
    return "1m";
  }
  return "1h";
}
