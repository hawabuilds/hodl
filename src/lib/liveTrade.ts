/**
 * Live HodlRouter ticket. Off for everyone until an allowlisted wallet
 * is set. Production stays on the existing ticket until the contract is
 * reviewed and the cap is raised.
 */
export const HODL_ROUTER_ADDRESS = (
  process.env.NEXT_PUBLIC_HODL_ROUTER ?? ""
).toLowerCase() as `0x${string}` | "";

export const FEE_COLLECTOR_ADDRESS = (
  process.env.NEXT_PUBLIC_FEE_COLLECTOR ?? ""
).toLowerCase() as `0x${string}` | "";

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
  if (opts.wallets.length === 0) return false;
  return opts.wallets.includes(wallet.toLowerCase());
}

/** Visible only to wallets on the allowlist, and only when the router is set. */
export function isLiveTrader(wallet: string | null | undefined): boolean {
  return liveTraderAllowed(wallet, {
    flag: LIVE_TRADE_FLAG,
    router: HODL_ROUTER_ADDRESS,
    wallets: allowlist(),
  });
}
