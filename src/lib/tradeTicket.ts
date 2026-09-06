import {QUOTE_USDG} from "./contracts";
import {hodlCanExecuteQuote} from "./liveTrade";
import {humanToRaw} from "./quoteAmounts";
import type {SwapQuote} from "./swapQuote";
import type {Asset} from "./types";
import {isEthish} from "./swapRoute";
import {PLATFORM_FEE_BPS} from "./venueQuote";

/**
 * Contract the ticket quotes and swaps. RWAs carry `contractAddress`;
 * launchpad tokens carry `address`.
 */
export function tradeTokenAddress(asset: Asset | null | undefined): `0x${string}` | null {
  const raw =
    asset?.kind === "rwa"
      ? asset.contractAddress
      : asset?.kind === "token"
        ? asset.address
        : "";
  return /^0x[0-9a-fA-F]{40}$/.test(raw)
    ? (raw.toLowerCase() as `0x${string}`)
    : null;
}

/**
 * What the user actually receives on a sell (or pays on a buy).
 * Never label a USDG or stock-token output as ETH.
 */
export function quoteOutSymbol(
  quote: Pick<SwapQuote, "quoteSymbol" | "quoteIsNative" | "quoteIsWeth" | "quoteToken">,
): string {
  if (quote.quoteIsNative || quote.quoteIsWeth || isEthish(quote.quoteToken)) return "ETH";
  if (quote.quoteToken.toLowerCase() === QUOTE_USDG) return "USDG";
  if (quote.quoteSymbol && quote.quoteSymbol !== "tokens") return quote.quoteSymbol;
  return quote.quoteSymbol || "tokens";
}

export function sellRouteLabel(
  quote: Pick<SwapQuote, "venueLabel" | "hops">,
): string {
  const hops = quote.hops ?? [];
  if (hops.length > 1) {
    return `Uniswap ${hops.map((hop) => (hop.venue === "v4" ? "V4" : "V3")).join(" → ")}`;
  }
  return quote.venueLabel;
}

/** HodlRouter actually skims 50 bps. Universal Router multi-hop does not. */
export function ticketTakesHodlFee(
  quote: Parameters<typeof hodlCanExecuteQuote>[0],
): boolean {
  return hodlCanExecuteQuote(quote);
}

export function platformFeeLabel(
  quote: Parameters<typeof hodlCanExecuteQuote>[0],
): {
  title: string;
  note: string | null;
  taken: boolean;
  bps: number;
} {
  const taken = ticketTakesHodlFee(quote);
  const bps = taken ? PLATFORM_FEE_BPS : 0;
  return {
    title: `Platform fee ${bps / 100}%`,
    note: taken ? null : "No platform fee on this route",
    taken,
    bps,
  };
}

/** What the user actually receives after any Hodl skim. UR uses the gross out. */
export function ticketNetOut(quote: Pick<SwapQuote, "amountOut" | "netOut" | "hops" | "quoteToken" | "pairToken" | "quoteIsNative" | "quoteIsWeth">): bigint {
  if (!ticketTakesHodlFee(quote)) return BigInt(quote.amountOut);
  return BigInt(quote.netOut || quote.amountOut);
}

/** Buy spends ETH on Hodl native/WETH and on UR multi-hop. */
export function buyPaysNative(
  quote: Pick<SwapQuote, "quoteIsNative" | "quoteIsWeth" | "quoteToken" | "hops"> | null | undefined,
): boolean {
  if (!quote) return false;
  if (quote.quoteIsNative || quote.quoteIsWeth) return true;
  return (quote.hops?.length ?? 0) > 1 && isEthish(quote.quoteToken);
}

/** Before a quote lands, show ETH — not $0 USDG — so a funded wallet is visible. */
export function buyAvailableIsEth(
  quote: Pick<SwapQuote, "quoteIsNative" | "quoteIsWeth" | "quoteToken" | "hops"> | null | undefined,
): boolean {
  if (!quote) return true;
  return buyPaysNative(quote);
}

export function buyMaxEntered(opts: {
  paysNative: boolean;
  ethUnits: number;
  ethUsd: number | null;
  currencyEth: boolean;
  spendUsd: number;
}): number {
  if (!opts.paysNative) return opts.spendUsd;
  if (!Number.isFinite(opts.ethUnits) || opts.ethUnits <= 0) return 0;
  if (opts.currencyEth) return opts.ethUnits;
  if (opts.ethUsd == null || opts.ethUsd <= 0) return 0;
  return opts.ethUnits * opts.ethUsd;
}

export function feeAmountSymbol(
  quote: Pick<SwapQuote, "quoteIsNative" | "quoteIsWeth" | "quoteToken" | "quoteSymbol">,
): string {
  if (quote.quoteIsNative || quote.quoteIsWeth || isEthish(quote.quoteToken)) return "ETH";
  if (quote.quoteToken.toLowerCase() === QUOTE_USDG) return "USDG";
  return quote.quoteSymbol || "tokens";
}

/**
 * Sell quick-size field is USD or ETH notional, not token units.
 * Putting `heldUnits` in that field is what made 100% show fake dollars/ETH.
 */
export function sellMaxEntered(opts: {
  heldUsd: number;
  currencyEth: boolean;
  ethUsd: number | null;
}): number {
  if (!Number.isFinite(opts.heldUsd) || opts.heldUsd <= 0) return 0;
  if (!opts.currencyEth) return opts.heldUsd;
  if (opts.ethUsd == null || opts.ethUsd <= 0) return 0;
  return opts.heldUsd / opts.ethUsd;
}

/**
 * Raw tokens to sell. 100% (or a rounding overshoot) uses the on-chain
 * balance; smaller notionals take that same balance pro-rata so we never
 * convert USD → tokens through a mark and request more than the wallet has.
 */
export function sellAmountInRaw(opts: {
  amountUsd: number;
  heldUsd: number;
  heldRaw: bigint;
  priceUsd: number | null;
  decimals: number;
}): bigint | undefined {
  if (opts.heldRaw > 0n && opts.heldUsd > 0 && Number.isFinite(opts.amountUsd) && opts.amountUsd > 0) {
    if (opts.amountUsd >= opts.heldUsd * 0.999) return opts.heldRaw;
    const bps = BigInt(Math.max(1, Math.round((opts.amountUsd / opts.heldUsd) * 10_000)));
    const raw = (opts.heldRaw * bps) / 10_000n;
    if (raw <= 0n) return undefined;
    return raw > opts.heldRaw ? opts.heldRaw : raw;
  }
  if (opts.priceUsd != null && opts.priceUsd > 0 && Number.isFinite(opts.amountUsd) && opts.amountUsd > 0) {
    const raw = humanToRaw(opts.amountUsd / opts.priceUsd, opts.decimals);
    if (opts.heldRaw > 0n && raw > opts.heldRaw) return opts.heldRaw;
    return raw > 0n ? raw : undefined;
  }
  return undefined;
}
