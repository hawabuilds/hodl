import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "./contracts";
import type {V4PoolKey} from "./v4Encoding";
import type {VenueId} from "./venueQuote";

/** Ticket and wallet copy when a sell has no hop into ETH. */
export const CANT_EXIT_TO_ETH = "Can't exit to ETH";

/** Ticket copy when a stock-paired buy has no ETH → pair hop. */
export const CANT_ENTER_FROM_ETH = "Can't buy with ETH";

/**
 * ETH → stock must return pair tokens worth at least this fraction of the
 * ETH spent. 50% still allows a thin book; it rejects a dust pool that
 * swallows the input (PRIMED: $100 ETH → $0.0006 AMZN).
 */
export const MIN_ETH_ENTRY_RETAIN_BPS = 5000;

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
 * True when the ETH → pair hop kept so little value that the rest of the
 * ETH was donated to the book. Round-trip the pair tokens through the
 * best ETH exit; do not trust a positive quoter amountOut alone.
 */
export function entryHopTooThin(
  ethIn: bigint,
  ethBack: bigint,
  minRetainBps: number = MIN_ETH_ENTRY_RETAIN_BPS,
): boolean {
  if (ethIn <= 0n || ethBack <= 0n) return true;
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(minRetainBps))));
  return ethBack * 10_000n < ethIn * bps;
}

/**
 * Prefer a single-hop ETH exit when it is within 3% of a multi-hop quote.
 * Doppler → stock → WETH can print a slightly higher number and then fail
 * to settle; a live AI/WETH pool should win ties like that.
 */
export function pickBestEthExit<T extends {ethOut: bigint; hop2?: unknown; exitHops?: unknown[]}>(
  ranked: T[],
): T | null {
  if (ranked.length === 0) return null;
  const best = ranked[0];
  const direct = ranked.find((row) => {
    if (row.exitHops) return row.exitHops.length === 0;
    return !row.hop2;
  });
  if (direct && direct !== best && direct.ethOut * 100n >= best.ethOut * 97n) {
    return direct;
  }
  return best;
}

/**
 * Uniswap-style venue pick: the official Quoter's highest amountOut wins.
 * An empty V4 5% book that returns dust cannot beat a liquid V3/USDG path.
 */
export function pickBestQuotedHop<T extends {amountOut: bigint}>(
  candidates: T[],
): T | null {
  let best: T | null = null;
  for (const row of candidates) {
    if (row.amountOut <= 0n) continue;
    if (!best || row.amountOut > best.amountOut) best = row;
  }
  return best;
}

/** Hops Uniswap quoted for ETH ↔ pair. One hop, or WETH → USDG → pair. */
export function ethPairHops<T extends {hop: SwapHop; hops?: SwapHop[]}>(
  entry: T,
): SwapHop[] {
  if (entry.hops && entry.hops.length > 0) return entry.hops;
  return [entry.hop];
}
