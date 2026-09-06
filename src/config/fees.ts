/**
 * What the platform charges.
 *
 * Flat 50 bps. No floor. The $1 dust guard is the only size check — a 50 bps
 * fee on $1 of USDG is 5_000 raw units, not 5e15.
 */
export const FEE_BPS = Number(process.env.NEXT_PUBLIC_FEE_BPS ?? 50);

/** Smallest trade the router will take, in dollars. Matches HodlRouter DUST_USDG. */
export const DUST_USD = 1;

export interface Fee {
  usd: number;
  /** What the fee works out to as a share of the trade, for disclosure. */
  pct: number;
}

export function feeFor(amountUsd: number): Fee {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return {usd: 0, pct: 0};
  }
  const usd = (amountUsd * FEE_BPS) / 10_000;
  return {usd, pct: FEE_BPS / 100};
}

/** Null when the trade is big enough, or the reason it is not. */
export function tooSmall(amountUsd: number): string | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  if (amountUsd >= DUST_USD) return null;
  return `Minimum trade is $${DUST_USD}.`;
}
