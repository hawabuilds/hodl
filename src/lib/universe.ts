/**
 * Whether a token belongs in HODL.
 *
 * The chain decides what exists. Supabase stores it. Providers only decorate.
 * Nothing else re-implements this test — feeds, search, portfolio and the
 * indexer all import from here.
 *
 * A token qualifies if it was deployed by Pons or Long AND either:
 *   1. its primary pool is paired against a verified RWA, or
 *   2. it is paired against ETH or USDG and routes holder rewards in an RWA.
 *
 * Two states:
 *   pending — Pons token that has not bonded yet. Stored, not shown.
 *   listed  — Pons token that has bonded, or any Long launch. Shown.
 */

import {normalizeAddress} from "./address";
import type {LaunchpadId} from "./contracts";

export type {LaunchpadId};
export type QuoteKind = "rwa" | "eth" | "usdg";
export type TokenStatus = "pending" | "listed";

export interface UniverseInput {
  launchpad: LaunchpadId | null;
  quoteKind: QuoteKind | null;
  /** Ticker of the RWA holders are paid in, when known. */
  rewardRwa: string | null;
  bonded: boolean;
}

export function statusFor(input: Pick<UniverseInput, "launchpad" | "bonded">): TokenStatus {
  if (input.launchpad === "long") return "listed";
  if (input.launchpad === "pons" && input.bonded) return "listed";
  return "pending";
}

/** Arm 1: proven launchpad, primary pair is a verified stock token. */
export function isRwaPaired(
  input: Pick<UniverseInput, "launchpad" | "quoteKind">,
): boolean {
  return input.launchpad !== null && input.quoteKind === "rwa";
}

/** Arm 2: ETH/USDG pair that pays holders in an RWA stock. */
export function paysHoldersInRwa(
  input: Pick<UniverseInput, "launchpad" | "quoteKind" | "rewardRwa">,
): boolean {
  if (input.launchpad === null) return false;
  if (input.quoteKind !== "eth" && input.quoteKind !== "usdg") return false;
  return Boolean(input.rewardRwa);
}

export function qualifiesForUniverse(input: UniverseInput): boolean {
  if (input.launchpad === null) return false;
  return isRwaPaired(input) || paysHoldersInRwa(input);
}

/** What the feeds and search are allowed to show. */
export function isListed(input: UniverseInput): boolean {
  return statusFor(input) === "listed" && qualifiesForUniverse(input);
}

export function quoteKindFor(
  quote: string,
  isVerifiedRwa: boolean,
): QuoteKind | null {
  const address = normalizeAddress(quote);
  if (isVerifiedRwa) return "rwa";
  if (
    address === "0x5fc5360d0400a0fd4f2af552add042d716f1d168" ||
    address === "usdg"
  ) {
    return "usdg";
  }
  if (
    address === "0x0bd7d308f8e1639fab988df18a8011f41eacad73" ||
    address === "0x0000000000000000000000000000000000000000" ||
    address === "weth" ||
    address === "eth"
  ) {
    return "eth";
  }
  return null;
}
