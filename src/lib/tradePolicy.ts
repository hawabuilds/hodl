import type {AssetKind} from "./types";
import type {VenueId} from "./venueQuote";

/**
 * Whether the live ticket can ask a wallet to sign.
 *
 * This is not a second router. Venue selection stays in `resolveVenue`.
 * These are the reasons the confirm button must stay off, or show an error,
 * instead of writing a simulated fill.
 */

export function ticketBlockReason(input: {
  kind: AssetKind;
  authenticated: boolean;
  demo: boolean;
  wallet: string | null;
  venue: VenueId | null | undefined;
  quotePending: boolean;
}): string | null {
  if (input.kind === "rwa") {
    return "This ticket swaps launchpad tokens on Uniswap. Tokenized stocks are not routed here.";
  }
  if (input.demo) {
    return "Demo mode has no signing wallet. Sign in with Privy to trade.";
  }
  if (!input.authenticated || !input.wallet) {
    return "Sign in to trade from your wallet.";
  }
  if (input.quotePending) return null;
  if (input.venue == null) {
    return "No Uniswap pool for this token.";
  }
  return null;
}

/** Slippage applied to the quoter's raw output. */
export function amountOutMinimum(amountOut: bigint, slippagePct: number): bigint {
  if (amountOut <= 0n) return 0n;
  const bps = BigInt(Math.round(Math.max(0, slippagePct) * 100));
  if (bps >= 10_000n) return 0n;
  return amountOut - (amountOut * bps) / 10_000n;
}

export function swapDeadlineSec(minutes = 5): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}
