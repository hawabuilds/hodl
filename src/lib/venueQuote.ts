/**
 * Per-quote venue selection. Not a stored venue on the token.
 *
 * V4 via Universal Router is the default path for new launches. V3 is the
 * fallback wherever it exists. The winner is whichever quote delivers more
 * tokens (or more quote) to the user after LP fee, impact, hook/creator tax
 * and our 0.5%. That is best execution, not a tax-bypass feature.
 */

import type {V4PoolKey} from "./v4Encoding";

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
  /** V4 PoolKey used to encode Universal Router execute. */
  poolKey?: V4PoolKey;
  /** V4 swap direction for that PoolKey. */
  zeroForOne?: boolean;
  /** V3 fee tier, when this candidate is a SwapRouter02 pool. */
  v3Fee?: number;
  v3Pool?: `0x${string}`;
}

export interface VenueDecision extends VenueCandidate {
  /** amountOut after our platform fee. What the ticket quotes. */
  netOut: bigint;
  platformFeeBps: number;
  /** Exact fee the Trade event will emit, in the fee token. */
  feeAmount: bigint;
}

export function feeOnAmount(amount: bigint, feeBps = PLATFORM_FEE_BPS): bigint {
  if (amount <= 0n) return 0n;
  return (amount * BigInt(feeBps)) / 10_000n;
}

/** Buys skim the input. Quote the remainder. */
export function inputAfterBuyFee(
  amountIn: bigint,
  feeBps = PLATFORM_FEE_BPS,
): bigint {
  if (amountIn <= 0n) return 0n;
  return amountIn - feeOnAmount(amountIn, feeBps);
}

export function netAfterPlatformFee(
  amountOut: bigint,
  feeBps = PLATFORM_FEE_BPS,
): bigint {
  if (amountOut <= 0n) return 0n;
  return amountOut - feeOnAmount(amountOut, feeBps);
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
  /**
   * Buys: the quoter already saw the post-fee input, so netOut = amountOut.
   * Sells: fee comes off the output.
   */
  feeOnOutput = true,
  inputAmount = 0n,
): VenueDecision | null {
  let best: VenueDecision | null = null;
  for (const candidate of candidates) {
    if (candidate.amountOut <= 0n) continue;
    const alreadyNet = amountOutFromQuoter(
      candidate.amountOut,
      candidate.creatorTaxBps,
    );
    const feeAmount = feeOnOutput
      ? feeOnAmount(alreadyNet, feeBps)
      : feeOnAmount(inputAmount, feeBps);
    const decided: VenueDecision = {
      ...candidate,
      amountOut: alreadyNet,
      netOut: feeOnOutput ? alreadyNet - feeAmount : alreadyNet,
      platformFeeBps: feeBps,
      feeAmount,
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

/** Uniswap V3 fee units are hundredths of a bip (3000 = 0.3% = 30 bps). */
export function v3FeeToBps(fee: number): number {
  return fee / 100;
}

export function lpFeeLabel(decision: VenueDecision): string {
  if (decision.venue === "v3" && decision.v3Fee != null) {
    return `${v3FeeToBps(decision.v3Fee)} bps LP`;
  }
  if (decision.poolKey?.fee === 0x800000) return "Dynamic LP fee";
  if (decision.poolKey?.fee === 0) return "0 bps LP";
  if (decision.poolKey?.fee != null) return `${v3FeeToBps(decision.poolKey.fee)} bps LP`;
  return "—";
}
