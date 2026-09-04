/**
 * Floor for a live pool to appear on New / Trending.
 *
 * Tune this — it is the only number the feed uses to drop dusty pools.
 * Unmeasured tokens are not compared to it and must not be hidden.
 *
 * Override with NEXT_PUBLIC_MIN_LIQUIDITY_USD without a code change.
 * After changing the floor, the next stats cron rewrites `is_tradeable`.
 */
const parsed = Number(process.env.NEXT_PUBLIC_MIN_LIQUIDITY_USD);
export const MIN_LIQUIDITY_USD =
  Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
