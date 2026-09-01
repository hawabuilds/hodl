/**
 * What the platform charges.
 *
 * Matched to FOMO: half a percent, with a flat floor. The floor is the part
 * that matters — at 50 bps a $20 trade earns ten cents, which is less than the
 * RPC calls, indexer time and database writes that trade costs to serve. The
 * floor makes small trades break even instead of losing money.
 *
 * Read from the environment so it can be changed without a code review, and
 * exposed to the client because the order dialog has to state it before anyone
 * confirms.
 */
export const FEE_BPS = Number(process.env.NEXT_PUBLIC_FEE_BPS ?? 50);

/** Minimum charge per trade, in dollars. Below this the percentage is ignored. */
export const FEE_MIN_USD = Number(process.env.NEXT_PUBLIC_FEE_MIN_USD ?? 0.95);

/**
 * The floor makes small trades expensive in percentage terms, so there is a
 * size below which charging at all is indefensible. A fee worth more than a
 * tenth of the trade is refused rather than taken.
 */
export const MAX_FEE_SHARE = 0.1;

/** Smallest trade the fee structure allows, given the floor and that share. */
export const MIN_TRADE_USD = FEE_MIN_USD / MAX_FEE_SHARE;

export interface Fee {
  usd: number;
  /** What the fee works out to as a share of the trade, for disclosure. */
  pct: number;
  /** True while the flat floor is what is being charged, not the percentage. */
  atFloor: boolean;
}

/**
 * The fee on a trade of this size.
 *
 * Always `max(floor, percentage)` — never the sum, and never the smaller of the
 * two. Returns the percentage alongside so the dialog can show both; someone
 * who works out the effective rate afterwards should find no surprise in it.
 */
export function feeFor(amountUsd: number): Fee {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return {usd: 0, pct: 0, atFloor: false};
  }

  const pctFee = (amountUsd * FEE_BPS) / 10_000;
  const usd = Math.max(FEE_MIN_USD, pctFee);

  return {
    usd,
    pct: (usd / amountUsd) * 100,
    atFloor: FEE_MIN_USD > pctFee,
  };
}

/** Null when the trade is big enough, or the reason it is not. */
export function tooSmall(amountUsd: number): string | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  if (amountUsd >= MIN_TRADE_USD) return null;
  return `Minimum trade is $${MIN_TRADE_USD.toFixed(2)}.`;
}
