import type {TokenAsset} from "./types";

/**
 * Community tokens the app tracks: RWA-paired migrations on Uniswap, plus
 * USDG/WETH pairs that pay RWA stock rewards or route fees to holders.
 */
export function qualifiesForUniverse(token: TokenAsset): boolean {
  if (!token.graduated || !token.tradesOnUniswap) return false;
  if (token.rwaPaired) return true;
  return token.paysRwaRewards || token.rewardsToHolders;
}

/**
 * The floor a graduated launch has to clear to count as a new listing.
 *
 * Graduating is cheap and constant — most of what comes off a curve is dust
 * that never trades again — so the New tab reads as a launch feed rather than
 * a firehose only once there is a real market behind each row.
 */
export const NEW_LISTING_MIN_MARKET_CAP_USD = 50_000;

/**
 * Tokens the New tab lists: a launchpad token that has finished bonding and
 * now trades on Uniswap, with a market worth looking at.
 *
 * Deliberately stricter than the universe above, in two ways. It requires a
 * launchpad this app can actually prove — Pons or Long, never a guess — where
 * the universe also admits RWA-paired tokens from anywhere. And it requires
 * graduation to mean what it means on the launchpad: fully bonded, curve
 * closed, trading in a real Uniswap pool.
 */
export function qualifiesAsNewListing(token: TokenAsset): boolean {
  if (token.launchpad === null) return false;
  if (!token.graduated || !token.tradesOnUniswap) return false;
  return token.marketCapUsd >= NEW_LISTING_MIN_MARKET_CAP_USD;
}
