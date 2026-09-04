import type {TokenAsset} from "./types";

/**
 * Community tokens the app tracks.
 *
 * Two ways in, and they are genuinely independent:
 *
 * 1. An RWA pair from a launchpad this app can prove — Pons or Long. The
 *    launchpad half was missing, so anything RWA-paired from anywhere counted;
 *    the proof matters, because the chain carries near-identical contracts
 *    from launchpads nobody vouches for.
 * 2. Paying holders in RWA stock, wherever it launched and whatever it trades
 *    against. This arm used to be gated behind graduation and a Uniswap-shaped
 *    pool as well, so a token that pays its holders but sits on any other venue
 *    was excluded on a technicality that has nothing to do with paying holders.
 *
 * Graduation is required only on the first arm, where it means something: a
 * token still on its bonding curve has no RWA pair yet, it has a curve. It is
 * deliberately *not* required on the second — whether a token pays its holders
 * is a fact about where its fees go, not about which venue it trades on.
 */
export function qualifiesForUniverse(token: TokenAsset): boolean {
  if (paysHoldersInRwa(token)) return true;
  return isProvenLaunchpadRwaPair(token);
}

/** Arm 2: the token routes real value back to the people holding it. */
export function paysHoldersInRwa(token: TokenAsset): boolean {
  return token.paysRwaRewards || token.rewardsToHolders;
}

/** Arm 1: an RWA pair, from Pons or Long, actually trading. */
export function isProvenLaunchpadRwaPair(token: TokenAsset): boolean {
  if (token.launchpad === null) return false;
  if (!token.rwaPaired) return false;
  return token.graduated && token.tradesOnUniswap;
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
