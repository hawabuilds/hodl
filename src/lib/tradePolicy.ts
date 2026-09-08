import {CANT_ENTER_FROM_ETH, CANT_EXIT_TO_ETH} from "./swapRoute";
import type {SwapHop} from "./swapRoute";
import type {SwapQuote} from "./swapQuote";
import type {AssetKind} from "./types";
import type {VenueId} from "./venueQuote";

/** Same ceiling HodlRouter enforces on-chain. UR buys had none. */
export const LIVE_BUY_MAX_USD = 100;

/** Quoted USD out below this on a real-sized buy is dust, not a fill. */
export const DUST_OUTPUT_USD = 1;

/**
 * Keep at least this fraction of input USD. 10% still allows a bonding-curve
 * hit; it rejects $100 in → $0.001 out.
 */
export const MIN_OUTPUT_VALUE_BPS = 1000;

export const ROUTE_NO_LIQUIDITY = "This route has no liquidity.";
export const LIVE_BUY_OVER_CAP = "This size is above the current notional cap.";
export const PRICE_IMPACT_TOO_HIGH = "Price impact too high";

/** Uniswap yellow: show the %, still allow confirm. */
export const IMPACT_WARN_BPS = 1500;
/** Uniswap red / extra confirm: disable signing. Dust vs notional also blocks. */
export const IMPACT_BLOCK_BPS = 5000;

export type BuyImpactLevel = "ok" | "warn" | "block";

/** 0.001 ETH — below this, raw-unit dust checks stay quiet. */
const REAL_ETH_IN = 10n ** 15n;
/** < 0.0001 of an 18-decimal pair token against a real ETH clip is crumbs. */
const DUST_PAIR_OUT = 10n ** 14n;

/** Ticket body when a quote miss is a missing hop, not a missing pool. */
export function quoteMissReason(error?: string | null): string {
  if (error && /can't exit to eth/i.test(error)) return CANT_EXIT_TO_ETH;
  if (error && /can't buy with eth/i.test(error)) return CANT_ENTER_FROM_ETH;
  if (error && /no liquidity/i.test(error)) return ROUTE_NO_LIQUIDITY;
  if (error && /notional cap/i.test(error)) return LIVE_BUY_OVER_CAP;
  return error || "No Uniswap pool for this token.";
}

/** Confirm button when the quote ran and found no route. */
export function quoteMissButtonLabel(error?: string | null): string {
  if (error && /can't exit to eth/i.test(error)) return CANT_EXIT_TO_ETH;
  if (error && /can't buy with eth/i.test(error)) return CANT_ENTER_FROM_ETH;
  if (error && /no liquidity/i.test(error)) return "No liquidity";
  if (error && /notional cap/i.test(error)) return "Over cap";
  return "No pool";
}

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
  quoteError?: string | null;
}): string | null {
  if (input.demo) {
    return "Demo mode has no signing wallet. Sign in with Privy to trade.";
  }
  if (!input.authenticated || !input.wallet) {
    return "Sign in to trade from your wallet.";
  }
  if (input.quotePending) return null;
  // Three-state: undefined = not quoted yet (keep the button usable),
  // null = quote ran and found no venue, v3/v4 = a real pool.
  if (input.venue === null) {
    return quoteMissReason(input.quoteError);
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

export function liveBuyOverCap(amountUsd: number): boolean {
  return Number.isFinite(amountUsd) && amountUsd > LIVE_BUY_MAX_USD;
}

export function outputValueTooLow(inUsd: number, outUsd: number): boolean {
  if (!Number.isFinite(inUsd) || inUsd <= 0) return true;
  if (!Number.isFinite(outUsd) || outUsd <= 0) return true;
  if (inUsd >= 5 && outUsd < DUST_OUTPUT_USD) return true;
  return outUsd * 10_000 < inUsd * MIN_OUTPUT_VALUE_BPS;
}

/** (usdIn − usdOut) / usdIn in bps. Never uses spend USD as the receive. */
export function priceImpactBps(usdIn: number, usdOut: number): number | null {
  if (!Number.isFinite(usdIn) || usdIn <= 0) return null;
  if (!Number.isFinite(usdOut) || usdOut < 0) return null;
  return Math.max(0, Math.round(((usdIn - usdOut) / usdIn) * 10_000));
}

export function formatImpactPct(bps: number): string {
  const pct = bps / 100;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

export function priceImpactLabel(bps: number | null): string {
  if (bps == null) return "—";
  return `Price impact ${formatImpactPct(bps)}`;
}

export function buyImpactLevel(
  bps: number | null,
  usdIn: number,
  usdOut: number,
): BuyImpactLevel {
  if (outputValueTooLow(usdIn, usdOut)) return "block";
  if (bps == null) return "ok";
  if (bps >= IMPACT_BLOCK_BPS) return "block";
  if (bps >= IMPACT_WARN_BPS) return "warn";
  return "ok";
}

/**
 * Hop-1 pair crumbs vs a real ETH clip. PRIMED: 0.04 ETH → 2.49e12 AMZN.
 * A $100 AMZN book (~0.4 shares, 18 dec) is 4e17 and passes.
 */
export function intermediateOutIsDust(ethIn: bigint, pairOut: bigint): boolean {
  if (ethIn < REAL_ETH_IN) return false;
  return pairOut < DUST_PAIR_OUT;
}

export function quotedPairOut(hops: SwapHop[] | undefined): bigint {
  if (!hops || hops.length < 2) return 0n;
  const raw = hops[hops.length - 1]?.amountIn;
  if (raw == null || raw === "") return 0n;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : 0n;
  } catch {
    return 0n;
  }
}

/** UR / V4 buy: never encode minOut of 0 or 1 against a real ETH clip. */
export function requireBuyMinOut(amountIn: bigint, minOut: bigint): bigint {
  if (amountIn >= REAL_ETH_IN && minOut <= 1n) {
    throw new Error(ROUTE_NO_LIQUIDITY);
  }
  return minOut;
}

/**
 * Fail closed before Universal Router execute. The PRIMED loss was a
 * successful swap with dust pair out and a last-hop min that the dust
 * still cleared.
 */
export function assertSaneUrBuy(opts: {
  amountIn: bigint;
  amountOutMinimum: bigint;
  hops?: SwapHop[];
}): void {
  requireBuyMinOut(opts.amountIn, opts.amountOutMinimum);
  const hops = opts.hops ?? [];
  if (hops.length < 2) return;
  const pairOut = quotedPairOut(hops);
  if (pairOut <= 0n || intermediateOutIsDust(opts.amountIn, pairOut)) {
    throw new Error(ROUTE_NO_LIQUIDITY);
  }
}

/**
 * Quote-time drop only. Dust / 99% impact stays on the ticket so the user
 * can see token out, receive USD, and impact. Encode still fail-closes.
 */
export function refuseUnsafeBuyQuote(opts: {
  quote: Pick<SwapQuote, "amountIn" | "amountOut" | "hops">;
  slippagePct: number;
  amountUsd: number;
}): string | null {
  if ((opts.quote.hops?.length ?? 0) < 2) return null;
  if (liveBuyOverCap(opts.amountUsd)) return LIVE_BUY_OVER_CAP;
  return null;
}

export function swapDeadlineSec(minutes = 5): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}
