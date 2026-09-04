import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "./contracts";

/**
 * Raw quote amounts on Robinhood Chain.
 *
 * USDG is 6 decimals. WETH and native ETH are 18. A helper that always
 * scales by 1e18 will overstate every USDG amount by 1e12 — including the
 * $1 dust guard and any bps fee taken in quote units.
 */

export const USDG_DECIMALS = 6;
export const WETH_DECIMALS = 18;

/** Smallest leftover the router is allowed to leave in the quote token. */
export const DUST_GUARD_USD = 1;

export function quoteTokenDecimals(token: string): number {
  const address = token.toLowerCase();
  if (address === QUOTE_USDG) return USDG_DECIMALS;
  if (address === QUOTE_WETH || address === QUOTE_ETH) return WETH_DECIMALS;
  throw new Error(`unknown quote token ${token}`);
}

/**
 * Face-value USDG is $1, so $n is n × 10^6 raw units.
 * WETH cannot be converted from dollars without a price — do not treat 1e18
 * as one dollar.
 */
export function usdgRawFromUsd(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`invalid usd amount ${usd}`);
  }
  return BigInt(Math.round(usd * 10 ** USDG_DECIMALS));
}

export function dustGuardRaw(quoteToken: string, usd = DUST_GUARD_USD): bigint {
  const address = quoteToken.toLowerCase();
  if (address === QUOTE_USDG) return usdgRawFromUsd(usd);
  throw new Error(
    "WETH/ETH dust guard needs an ETH/USD price; do not assume 18-decimal $1",
  );
}

export function applyBps(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`invalid bps ${bps}`);
  }
  return (amount * BigInt(bps)) / 10_000n;
}

export function humanToRaw(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`invalid amount ${amount}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`invalid decimals ${decimals}`);
  }
  return BigInt(Math.round(amount * 10 ** decimals));
}
