import {FEE_COLLECTOR, QUOTE_USDG} from "./contracts";
import {isEthish} from "./swapRoute";
import type {SwapHop} from "./swapRoute";

/**
 * Live HodlRouter ticket. Master switch is NEXT_PUBLIC_LIVE_TRADE=1 plus a
 * configured router. An optional wallet list still restricts; empty or
 * absent means every signed-in wallet.
 */
export const HODL_ROUTER_ADDRESS = (
  process.env.NEXT_PUBLIC_HODL_ROUTER ?? ""
).toLowerCase() as `0x${string}` | "";

export const FEE_COLLECTOR_ADDRESS = (
  process.env.NEXT_PUBLIC_FEE_COLLECTOR || FEE_COLLECTOR
).toLowerCase() as `0x${string}`;

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
export function hodlCanExecuteQuote(quote: {
  quoteIsNative?: boolean;
  quoteIsWeth?: boolean;
  quoteToken?: string | null;
  pairToken?: string | null;
  hops?: SwapHop[];
} | null | undefined): boolean {
  if (!quote) return false;
  if (quote.hops && quote.hops.length > 1) return false;
  const pair = quote.pairToken?.toLowerCase();
  if (pair && !isEthish(pair) && pair !== QUOTE_USDG) return false;
  if (quote.quoteIsNative || quote.quoteIsWeth) return true;
  return quote.quoteToken?.toLowerCase() === QUOTE_USDG;
}
