import {QUOTE_USDG} from "./contracts";
import {hodlCanExecuteQuote} from "./liveTrade";
import {price, units} from "./format";
import {humanToRaw} from "./quoteAmounts";
import type {SwapQuote} from "./swapQuote";
import type {Asset} from "./types";
import {isEthish} from "./swapRoute";
import {
  buyImpactLevel,
  priceImpactBps,
  priceImpactLabel,
  type BuyImpactLevel,
} from "./tradePolicy";
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

/** Units the ticket actually delivers. Buys pay ETH and receive the asset. */
export function ticketReceivedSymbol(opts: {
  side: "buy" | "sell";
  tokenSymbol: string;
  quote: Pick<SwapQuote, "quoteSymbol" | "quoteIsNative" | "quoteIsWeth" | "quoteToken">;
}): string {
  if (opts.side === "buy") return opts.tokenSymbol || "tokens";
  return quoteOutSymbol(opts.quote);
}

/** Mark USD of quoted token out. Never the typed spend — that hid the PRIMED loss. */
export function buyPreviewUsd(opts: {
  amountTokens: number;
  priceUsd: number | null | undefined;
}): number {
  return sellPreviewUsd(opts);
}

/**
 * Prefer hop-implied USD when the API quoted it. If a mark also exists, use
 * the lower figure so a stale high mark cannot relabel dust as a $100 fill.
 */
export function honestReceiveUsd(
  markUsd: number,
  quotedUsdOut?: number | null,
): number {
  const quoted =
    quotedUsdOut != null && Number.isFinite(quotedUsdOut) && quotedUsdOut >= 0
      ? quotedUsdOut
      : null;
  if (quoted != null && Number.isFinite(markUsd) && markUsd > 0) {
    return Math.min(markUsd, quoted);
  }
  if (quoted != null) return quoted;
  return markUsd;
}

/** Buy ticket copy: token out, receive USD, impact. Spend USD is never the receive. */
export function buyReceivePreview(opts: {
  amountTokens: number;
  tokenSymbol: string;
  markPriceUsd: number | null | undefined;
  spendUsd: number;
  quotedUsdOut?: number | null;
}): {
  youReceive: string;
  receiveUsd: number;
  receiveUsdLabel: string;
  impactBps: number | null;
  impactLabel: string;
  impactLevel: BuyImpactLevel;
} {
  const markUsd = buyPreviewUsd({
    amountTokens: opts.amountTokens,
    priceUsd: opts.markPriceUsd,
  });
  const receiveUsd = honestReceiveUsd(markUsd, opts.quotedUsdOut);
  const impactBps = priceImpactBps(opts.spendUsd, receiveUsd);
  const symbol = opts.tokenSymbol || "tokens";
  return {
    youReceive: `You receive ${units(opts.amountTokens)} ${symbol}`,
    receiveUsd,
    receiveUsdLabel: Number.isFinite(receiveUsd) ? `≈ ${price(receiveUsd)}` : "≈ —",
    impactBps,
    impactLabel: priceImpactLabel(impactBps),
    impactLevel: buyImpactLevel(impactBps, opts.spendUsd, receiveUsd),
  };
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

/** Sell field is token units of the asset, not a dollar/ETH notional. */
export function sellMaxEntered(opts: {heldUnits: number}): number {
  if (!Number.isFinite(opts.heldUnits) || opts.heldUnits <= 0) return 0;
  return opts.heldUnits;
}

/**
 * Raw tokens to sell from a typed token amount. 100% uses the on-chain
 * balance so float rounding cannot request more than the wallet holds.
 */
export function sellAmountInRaw(opts: {
  amountTokens: number;
  heldRaw: bigint;
  decimals: number;
  sellAll?: boolean;
}): bigint | undefined {
  if (opts.heldRaw <= 0n) return undefined;
  if (opts.sellAll) return opts.heldRaw;
  if (!Number.isFinite(opts.amountTokens) || opts.amountTokens <= 0) return undefined;
  const raw = humanToRaw(opts.amountTokens, opts.decimals);
  if (raw <= 0n) return undefined;
  return raw > opts.heldRaw ? opts.heldRaw : raw;
}

/** Estimated USD for a typed token sell — preview only, never the submit size. */
export function sellPreviewUsd(opts: {
  amountTokens: number;
  priceUsd: number | null | undefined;
}): number {
  if (!Number.isFinite(opts.amountTokens) || opts.amountTokens <= 0) return Number.NaN;
  if (opts.priceUsd == null || !Number.isFinite(opts.priceUsd) || opts.priceUsd <= 0) {
    return Number.NaN;
  }
  return opts.amountTokens * opts.priceUsd;
}
