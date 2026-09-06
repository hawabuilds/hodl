import {QUOTE_USDG, QUOTE_WETH} from "./contracts";
import {humanToRaw} from "./quoteAmounts";
import type {SwapQuote} from "./swapQuote";
import type {Asset} from "./types";

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
  if (quote.quoteSymbol && quote.quoteSymbol !== "tokens") return quote.quoteSymbol;
  if (quote.quoteIsNative || quote.quoteIsWeth) return "ETH";
  if (quote.quoteToken.toLowerCase() === QUOTE_USDG) return "USDG";
  if (quote.quoteToken.toLowerCase() === QUOTE_WETH) return "ETH";
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
