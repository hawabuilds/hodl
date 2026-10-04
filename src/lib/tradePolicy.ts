import {HODL_ROUTER_V1, QUOTE_USDG} from "./contracts";
import {CANT_ENTER_FROM_ETH, CANT_EXIT_TO_ETH} from "./swapRoute";
import type {SwapHop} from "./swapRoute";
import type {SwapQuote} from "./swapQuote";
import type {AssetKind} from "./types";
import {PLATFORM_FEE_BPS, type VenueId} from "./venueQuote";

/**
 * Per-trade cap in USD while the contracts are unaudited: the same ceiling
 * HodlRouter enforces on-chain (`maxNotionalUsd`). The app applies it to every
 * route, buys and sells, so a trade over it never reaches the wallet.
 */
export const LIVE_BUY_MAX_USD = 100;

/** Quoted USD out below this on a real-sized buy is dust, not a fill. */
export const DUST_OUTPUT_USD = 1;

/**
 * Keep at least this fraction of input USD. 10% still allows a bonding-curve
 * hit; it rejects $100 in → $0.001 out.
 */
export const MIN_OUTPUT_VALUE_BPS = 1000;

export const ROUTE_NO_LIQUIDITY = "This route has no liquidity.";
export const LIVE_BUY_OVER_CAP = `Max $${LIVE_BUY_MAX_USD} per trade for now`;
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
/** $1 of USDG (6 decimals): the same "real clip" line for a USD-paid buy. */
const REAL_USDG_IN = 10n ** 6n;
/** < 0.0001 USDG is crumbs, the 6-decimal twin of DUST_PAIR_OUT. */
const DUST_USDG_OUT = 10n ** 2n;

function isUsdg(token: string | null | undefined): boolean {
  return (token ?? "").toLowerCase() === QUOTE_USDG;
}

/** The raw input below which dust checks stay quiet, in the paying token's units. */
function realInput(payToken?: string | null): bigint {
  return isUsdg(payToken) ? REAL_USDG_IN : REAL_ETH_IN;
}

/** The cap message, or the older wording a cached response may still carry. */
function isCapError(error?: string | null): boolean {
  return Boolean(error && (error === LIVE_BUY_OVER_CAP || /notional cap/i.test(error)));
}

/** Ticket body when a quote miss is a missing hop, not a missing pool. */
export function quoteMissReason(error?: string | null): string {
  if (error && /can't exit to eth/i.test(error)) return CANT_EXIT_TO_ETH;
  if (error && /can't buy with eth/i.test(error)) return CANT_ENTER_FROM_ETH;
  if (error && /no liquidity/i.test(error)) return ROUTE_NO_LIQUIDITY;
  if (isCapError(error)) return LIVE_BUY_OVER_CAP;
  return error || "No Uniswap pool for this token.";
}

/** Confirm button when the quote ran and found no route. */
export function quoteMissButtonLabel(error?: string | null): string {
  if (error && /can't exit to eth/i.test(error)) return CANT_EXIT_TO_ETH;
  if (error && /can't buy with eth/i.test(error)) return CANT_ENTER_FROM_ETH;
  if (error && /no liquidity/i.test(error)) return "No liquidity";
  if (isCapError(error)) return LIVE_BUY_OVER_CAP;
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

/**
 * HodlRouter `minAmountOut` for a quote.
 *
 * Buys: the router takes its fee from the input, so the quote's `netOut` is
 * already what the buyer receives.
 *
 * Sells: the router takes its fee from the output. v1 compared the minimum
 * with the swap output *before* the fee; v2 compares it with what the seller
 * actually receives *after* the fee. Basing a v2 sell on the gross output
 * would leave only (slippage − 0.5%) of real price tolerance, so v2 sells use
 * the after-fee amount. The v1 rule applies only to the v1 router address.
 */
export function hodlRouterMinOut(opts: {
  router: string;
  side: "buy" | "sell";
  amountOut: bigint;
  netOut: bigint;
  slippagePct: number;
}): bigint {
  if (opts.side === "buy") return amountOutMinimum(opts.netOut, opts.slippagePct);
  if (opts.router.toLowerCase() === HODL_ROUTER_V1) {
    return amountOutMinimum(opts.amountOut, opts.slippagePct);
  }
  const afterFee = opts.amountOut - (opts.amountOut * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
  // A quote without its own netOut falls back to amountOut; never trust a
  // figure above what the router can pay after its fee.
  const received = opts.netOut > 0n && opts.netOut < afterFee ? opts.netOut : afterFee;
  return amountOutMinimum(received, opts.slippagePct);
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
export function intermediateOutIsDust(
  ethIn: bigint,
  pairOut: bigint,
  /** Units of `ethIn` and `pairOut` when either is USDG (6 decimals), not 18. */
  tokens: {payToken?: string | null; pairToken?: string | null} = {},
): boolean {
  if (ethIn < realInput(tokens.payToken)) return false;
  return pairOut < (isUsdg(tokens.pairToken) ? DUST_USDG_OUT : DUST_PAIR_OUT);
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
export function requireBuyMinOut(
  amountIn: bigint,
  minOut: bigint,
  payToken?: string | null,
): bigint {
  if (amountIn >= realInput(payToken) && minOut <= 1n) {
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
  const hops = opts.hops ?? [];
  const payToken = hops[0]?.tokenIn ?? null;
  requireBuyMinOut(opts.amountIn, opts.amountOutMinimum, payToken);
  if (hops.length < 2) return;
  const pairOut = quotedPairOut(hops);
  const pairToken = hops[hops.length - 1]?.tokenIn ?? null;
  if (pairOut <= 0n || intermediateOutIsDust(opts.amountIn, pairOut, {payToken, pairToken})) {
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
