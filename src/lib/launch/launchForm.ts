/**
 * What a launch form must say before it may be submitted.
 *
 * Pure, and free of any registry import, so the sheet and the confirm route
 * apply the same rules. Every check returns a sentence a person can act on
 * rather than a boolean, which is how `tradePolicy.ts` already does it.
 *
 * The rule worth naming is the eligibility one. `qualifiesForUniverse()` lets
 * a token into hodl when it is paired against a verified stock, or paired
 * against ETH/USDG and pays holders in one. A launch that satisfies neither
 * succeeds on chain and is then invisible in the app that launched it — the
 * creator gets a token and no page for it.
 *
 * So the form refuses to submit until one arm is genuinely met, and says
 * which. `universe.ts` is deliberately not touched: its header says nothing
 * else may re-implement that test, and weakening the rule to admit our own
 * tokens would make the feed's promise untrue rather than make the token
 * eligible.
 */

import {isAddress} from "@/lib/address";
import {qualifiesForUniverse, type QuoteKind} from "@/lib/universe";

import type {LaunchpadTarget} from "./launchConfig";

/** A pair token the user may price their launch in. */
export interface PairOption {
  address: string;
  /** Ticker for a stock, symbol otherwise. */
  label: string;
  /** Company name, shown on hover so a ticker chip is not a riddle. */
  name?: string;
  quoteKind: QuoteKind;
  /** Verified RWA stocks are the default because they satisfy arm 1 alone. */
  isRwa: boolean;
}

export interface LaunchDraft {
  launchpad: LaunchpadTarget;
  name: string;
  symbol: string;
  /** Public URL of the uploaded logo, or empty while none is chosen. */
  logo: string;
  description: string;
  pair: PairOption | null;
  /** Ticker of the RWA holders are paid in. Only meaningful off an RWA pair. */
  rewardRwa: string | null;
  /** Creator tax in basis points. */
  creatorTaxBps: number;
  /** Initial buy, as a decimal string in the pair token. Empty for none. */
  devBuy: string;
  socials: {x?: string; telegram?: string; discord?: string; website?: string};
}

export const MAX_NAME = 32;
export const MAX_SYMBOL = 10;
export const MAX_DESCRIPTION = 280;
/** Pons stores the tax as uint16 bps and the factory caps it well below this. */
export const MAX_CREATOR_TAX_BPS = 1000;

const SYMBOL_SHAPE = /^[A-Za-z0-9.]+$/;

/**
 * Whether this draft would produce a token hodl can show.
 *
 * Delegates to the real gate rather than restating it, so the form cannot
 * drift away from what the feeds actually do.
 */
export function draftQualifies(draft: LaunchDraft): boolean {
  if (!draft.pair) return false;
  return qualifiesForUniverse({
    launchpad: draft.launchpad,
    quoteKind: draft.pair.quoteKind,
    rewardRwa: draft.rewardRwa,
    bonded: false,
  });
}

/**
 * The first reason this draft cannot be launched, or null when it can.
 *
 * Ordered the way someone fills the form in, so the message tracks where they
 * are rather than jumping to the last field.
 */
export function launchBlockReason(draft: LaunchDraft): string | null {
  const name = draft.name.trim();
  const symbol = draft.symbol.trim();

  if (!name) return "Give it a name.";
  if (name.length > MAX_NAME) return `Name is over ${MAX_NAME} characters.`;
  if (!symbol) return "Give it a ticker.";
  if (symbol.length > MAX_SYMBOL) return `Ticker is over ${MAX_SYMBOL} characters.`;
  if (!SYMBOL_SHAPE.test(symbol)) return "Tickers are letters and numbers only.";
  if (draft.description.length > MAX_DESCRIPTION) {
    return `Description is over ${MAX_DESCRIPTION} characters.`;
  }
  if (!draft.logo) return "Add a picture.";
  if (!draft.pair) return "Pick what it trades against.";
  if (!isAddress(draft.pair.address) && draft.pair.quoteKind !== "eth") {
    return "That pair token is not a valid address.";
  }
  if (draft.creatorTaxBps < 0 || draft.creatorTaxBps > MAX_CREATOR_TAX_BPS) {
    return `Creator fee must be between 0% and ${MAX_CREATOR_TAX_BPS / 100}%.`;
  }
  if (!Number.isInteger(draft.creatorTaxBps)) {
    return "Creator fee must be a whole number of basis points.";
  }

  // The eligibility arms, phrased as the fix rather than the rule.
  if (!draftQualifies(draft)) {
    return draft.pair.isRwa
      ? "That pair is not a verified stock, so the token would not show in hodl."
      : `Pick a stock for holder rewards, or price it in a stock — otherwise ${
          symbol || "the token"
        } will trade but never appear in hodl.`;
  }

  if (draft.devBuy.trim()) {
    const amount = Number(draft.devBuy);
    if (!Number.isFinite(amount) || amount <= 0) return "That is not an amount.";
  }

  return null;
}

/**
 * How many signatures this draft needs.
 *
 * Pons reverts unless `msg.value` equals the launch fee exactly, so an
 * initial buy cannot ride along — it is a second transaction against the
 * curve. The form says so before the button is pressed, not after.
 */
export function launchSignatureCount(draft: LaunchDraft): 1 | 2 {
  return draft.devBuy.trim() && Number(draft.devBuy) > 0 ? 2 : 1;
}

/** Pons takes name and symbol; Long takes both plus a metadata document. */
export function launchNeedsTokenUri(launchpad: LaunchpadTarget): boolean {
  return launchpad === "long";
}
