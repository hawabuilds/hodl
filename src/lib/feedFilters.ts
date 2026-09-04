import {ageHoursSince, meetsBound} from "@/lib/priceState";
import type {FeedWindow, TokenAsset} from "@/lib/types";

/**
 * The feed's custom filters.
 *
 * Separate from the sort rail beside it: the rail picks one ordering, this
 * narrows what is in the list at all. Ranges are open-ended on both sides —
 * "over $100k" is a far more common thing to want than a band, and requiring
 * both ends would make the simple case the awkward one.
 */

export interface FeedFilterState {
  /**
   * Which window volume and price move are *displayed* / sorted over.
   * Not an inclusion bound. Volume min/max always read 24h (`vol_24h`) —
   * that is the only stored volume column.
   */
  window: FeedWindow;
  minMarketCap: number | null;
  maxMarketCap: number | null;
  minLiquidity: number | null;
  maxLiquidity: number | null;
  /** 24h USD volume (`vol_24h`), regardless of `window`. */
  minVolume: number | null;
  maxVolume: number | null;
  /** Age of the token, in hours since `createdAt`. */
  minAgeHours: number | null;
  maxAgeHours: number | null;
}

export const NO_FILTERS: FeedFilterState = {
  window: "24h",
  minMarketCap: null,
  maxMarketCap: null,
  minLiquidity: null,
  maxLiquidity: null,
  minVolume: null,
  maxVolume: null,
  minAgeHours: null,
  maxAgeHours: null,
};

/** How many ranges are set, for the dot on the button. */
export function activeFilterCount(state: FeedFilterState): number {
  const pairs: [number | null, number | null][] = [
    [state.minMarketCap, state.maxMarketCap],
    [state.minLiquidity, state.maxLiquidity],
    [state.minVolume, state.maxVolume],
    [state.minAgeHours, state.maxAgeHours],
  ];
  let count = pairs.filter(([lo, hi]) => lo !== null || hi !== null).length;
  if (state.window !== NO_FILTERS.window) count += 1;
  return count;
}

/** Whether one token survives the filters. Client safety net — server is source of truth. */
export function passesFilters(
  token: TokenAsset,
  state: FeedFilterState,
  now: number = Date.now(),
): boolean {
  return (
    meetsBound(token.marketCapUsd, state.minMarketCap, state.maxMarketCap) &&
    meetsBound(token.liquidityUsd, state.minLiquidity, state.maxLiquidity) &&
    meetsBound(token.volume24hUsd, state.minVolume, state.maxVolume) &&
    meetsBound(ageHoursSince(token.createdAt, now), state.minAgeHours, state.maxAgeHours)
  );
}
