/**
 * Per-quote venue selection. Not a stored venue on the token.
 *
 * V4 via Universal Router is the default path for new launches. V3 is the
 * fallback wherever it exists. The winner is whichever quote delivers more
 * tokens (or more quote) to the user after LP fee, impact, hook/creator tax
 * and our 0.5%. That is best execution, not a tax-bypass feature.
 */

export type VenueId = "v4" | "v3";

export const PLATFORM_FEE_BPS = 50;

export interface VenueCandidate {
  venue: VenueId;
  /** Raw quoter output — already net of LP fee, impact, and hook tax. */
  amountOut: bigint;
  /** Creator tax that this route actually charges, in bps. */
  creatorTaxBps: number;
  quoteToken: `0x${string}`;
  label: string;
}

export interface VenueDecision extends VenueCandidate {
  /** amountOut after our platform fee. What the ticket quotes. */
  netOut: bigint;
  platformFeeBps: number;
}

export function netAfterPlatformFee(
  amountOut: bigint,
  feeBps = PLATFORM_FEE_BPS,
): bigint {
  if (amountOut <= 0n) return 0n;
  return amountOut - (amountOut * BigInt(feeBps)) / 10_000n;
}

/**
 * V4Quoter already runs the hook. The quoted amount is net of creator tax.
 * Stated bps must not be applied a second time.
 */
export function amountOutFromQuoter(
  quoted: bigint,
  _statedCreatorTaxBps?: number,
): bigint {
  return quoted;
}

/** Highest net output wins. Ties keep the earlier candidate (V4 first). */
export function pickBestVenue(
  candidates: VenueCandidate[],
  feeBps = PLATFORM_FEE_BPS,
): VenueDecision | null {
  let best: VenueDecision | null = null;
  for (const candidate of candidates) {
    if (candidate.amountOut <= 0n) continue;
    const alreadyNet = amountOutFromQuoter(
      candidate.amountOut,
      candidate.creatorTaxBps,
    );
    const decided: VenueDecision = {
      ...candidate,
      amountOut: alreadyNet,
      netOut: netAfterPlatformFee(alreadyNet, feeBps),
      platformFeeBps: feeBps,
    };
    if (!best || decided.netOut > best.netOut) best = decided;
  }
  return best;
}

export function venueTicketCopy(decision: VenueDecision): {
  venue: string;
  creatorTax: string;
} {
  return {
    venue: decision.venue === "v4" ? "Uniswap V4" : "Uniswap V3",
    creatorTax:
      decision.creatorTaxBps > 0
        ? `${(decision.creatorTaxBps / 100).toFixed(2)}% creator tax on this route`
        : "No creator tax on this route",
  };
}
