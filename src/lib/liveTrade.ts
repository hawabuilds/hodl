import {HODL_ROUTER, HODL_ROUTER_V1, QUOTE_ETH, QUOTE_USDG} from "./contracts";
import {isEthish} from "./swapRoute";
import type {SwapHop} from "./swapRoute";

/**
 * Live HodlRouter ticket. Master switch is NEXT_PUBLIC_LIVE_TRADE=1. An
 * optional wallet list still restricts; empty or absent means every
 * signed-in wallet. The address itself comes from `contracts.ts`.
 */
export const HODL_ROUTER_ADDRESS: `0x${string}` = HODL_ROUTER;

export const LIVE_TRADE_FLAG = process.env.NEXT_PUBLIC_LIVE_TRADE === "1";

function allowlist(): string[] {
  return (process.env.NEXT_PUBLIC_LIVE_TRADE_WALLETS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value));
}

export function isHodlRouterConfigured(address: string = HODL_ROUTER_ADDRESS): boolean {
  return /^0x[a-f0-9]{40}$/.test(address);
}

export function liveTraderAllowed(
  wallet: string | null | undefined,
  opts: {flag: boolean; router: string; wallets: string[]},
): boolean {
  if (!opts.flag || !isHodlRouterConfigured(opts.router) || !wallet) return false;
  if (opts.wallets.length === 0) return true;
  return opts.wallets.includes(wallet.toLowerCase());
}

/** On for every signed-in wallet when the flag and router are set. */
export function isLiveTrader(wallet: string | null | undefined): boolean {
  return liveTraderAllowed(wallet, {
    flag: LIVE_TRADE_FLAG,
    router: HODL_ROUTER_ADDRESS,
    wallets: allowlist(),
  });
}

/**
 * HodlRouter._isQuote only accepts native ETH, WETH, and USDG.
 * Multi-hop stock/SPCX → ETH must go through Universal Router.
 * A sell quote that already says "ETH out" is still Hodl-ineligible when
 * the pool pair is a stock — Hodl cannot hop SPCX to ETH.
 */
export function hodlCanExecuteQuote(
  quote: {
    venue?: "v4" | "v3";
    quoteIsNative?: boolean;
    quoteIsWeth?: boolean;
    quoteToken?: string | null;
    pairToken?: string | null;
    hops?: SwapHop[];
  } | null | undefined,
  side?: "buy" | "sell",
  router: string = HODL_ROUTER_ADDRESS,
): boolean {
  if (!quote) return false;
  if (quote.hops && quote.hops.length > 1) return false;
  // Selling into a native-ETH V4 pool pays ETH straight from the PoolManager.
  // v1's receive() only takes ETH from WETH or the Universal Router, so that
  // sell reverts (NothingSupplied, wrapped as NativeTransferFailed); the
  // Universal Router route sells it and takes the same fee. v2 accepts ETH
  // during any trade, so this only applies to the v1 address.
  if (
    side === "sell" &&
    quote.venue === "v4" &&
    isNativeQuote(quote) &&
    router.toLowerCase() === HODL_ROUTER_V1
  ) {
    return false;
  }
  const pair = quote.pairToken?.toLowerCase();
  if (pair && !isEthish(pair) && pair !== QUOTE_USDG) return false;
  if (quote.quoteIsNative || quote.quoteIsWeth) return true;
  return quote.quoteToken?.toLowerCase() === QUOTE_USDG;
}

function isNativeQuote(quote: {quoteIsNative?: boolean; quoteToken?: string | null}): boolean {
  return Boolean(quote.quoteIsNative) || quote.quoteToken?.toLowerCase() === QUOTE_ETH;
}
