import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "./contracts";
import type {V4PoolKey} from "./v4Encoding";
import type {VenueId} from "./venueQuote";

/** Ticket and wallet copy when a sell has no hop into ETH. */
export const CANT_EXIT_TO_ETH = "Can't exit to ETH";

export interface SwapHop {
  venue: VenueId;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  /** Quoted input for this hop. First hop uses the ticket `amountIn`. */
  amountIn?: string;
  zeroForOne?: boolean;
  poolKey?: V4PoolKey | null;
  v3Fee?: number | null;
}

export function isEthish(token: string | null | undefined): boolean {
  const value = token?.toLowerCase() ?? "";
  return value === QUOTE_ETH || value === QUOTE_WETH;
}

export function isHodlQuoteToken(token: string | null | undefined): boolean {
  const value = token?.toLowerCase() ?? "";
  return isEthish(value) || value === QUOTE_USDG;
}

export function hopTokenOut(hops: SwapHop[] | undefined, fallback: string): string {
  if (hops && hops.length > 0) return hops[hops.length - 1].tokenOut;
  return fallback;
}

export function sellExitsToEth(
  hops: SwapHop[] | undefined,
  quoteToken: string,
): boolean {
  return isEthish(hopTokenOut(hops, quoteToken));
}

/**
 * Prefer a single-hop ETH exit when it is within 3% of a multi-hop quote.
 * Doppler → stock → WETH can print a slightly higher number and then fail
 * to settle; a live AI/WETH pool should win ties like that.
 */
export function pickBestEthExit<T extends {ethOut: bigint; hop2?: unknown}>(
  ranked: T[],
): T | null {
  if (ranked.length === 0) return null;
  const best = ranked[0];
  const direct = ranked.find((row) => !row.hop2);
  if (direct && direct !== best && direct.ethOut * 100n >= best.ethOut * 97n) {
    return direct;
  }
  return best;
}
