/**
 * Trending feed floors and momentum weights.
 *
 * Applied when the home tab sorts by Trending unless the user sets an
 * explicit filter bound (those override the defaults).
 */

function readUsd(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readUnit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Minimum measured market cap for Trending. Default ~$50k. */
export const TRENDING_MIN_MARKET_CAP_USD = readUsd(
  "TRENDING_MIN_MARKET_CAP_USD",
  50_000,
);

/**
 * Minimum pool liquidity for Trending.
 *
 * Higher than the global dust floor (`MIN_LIQUIDITY_USD`) so thin pools do
 * not dominate on raw volume spikes.
 */
export const TRENDING_MIN_LIQUIDITY_USD = readUsd(
  "TRENDING_MIN_LIQUIDITY_USD",
  5_000,
);

export interface TrendingWeights {
  /** log1p(surge) weight for the last hour vs a flat 24h pace. */
  weight1h: number;
  /** log1p(surge) weight for the last 6h vs a flat 24h pace. */
  weight6h: number;
  /** log1p(24h volume) weight — tie-breaker, not the main signal. */
  weight24h: number;
  /** Floor for hourly baseline when 24h volume is tiny. */
  minBaselineHourlyUsd: number;
  /** Floor for the 24h volume term. */
  minBaseline24hUsd: number;
  /** Multiplier strength for unique buyer participation (log scale). */
  buyerBoost: number;
  /** Multiplier strength for absolute 1h price move. */
  priceBoost: number;
  /** Start penalising wash-like prints above this 1h volume. */
  washMinVolumeUsd: number;
  /** Fewer than this many 1h swaps → downrank. */
  washMinTxns1h: number;
  /** Fewer than this many 1h buys → downrank. */
  washMinBuys1h: number;
  /** Multiplier when txn count is suspiciously low for the volume. */
  washLowTxnPenalty: number;
  /** Average trade size above this → downrank (same wallets churning). */
  washMaxAvgTradeUsd: number;
  /** Multiplier when average trade size looks like wash. */
  washWhalePenalty: number;
  /** Below this score after penalties → exclude entirely. */
  washExcludeBelow: number;
}

export const TRENDING_WEIGHTS: TrendingWeights = {
  weight1h: readUnit("TRENDING_WEIGHT_1H", 1.0),
  weight6h: readUnit("TRENDING_WEIGHT_6H", 0.35),
  weight24h: readUnit("TRENDING_WEIGHT_24H", 0.15),
  minBaselineHourlyUsd: readUsd("TRENDING_MIN_BASELINE_HOURLY_USD", 250),
  minBaseline24hUsd: readUsd("TRENDING_MIN_BASELINE_24H_USD", 1_000),
  buyerBoost: readUnit("TRENDING_BUYER_BOOST", 0.35),
  priceBoost: readUnit("TRENDING_PRICE_BOOST", 0.2),
  washMinVolumeUsd: readUsd("TRENDING_WASH_MIN_VOLUME_USD", 2_000),
  washMinTxns1h: readUnit("TRENDING_WASH_MIN_TXNS_1H", 4),
  washMinBuys1h: readUnit("TRENDING_WASH_MIN_BUYS_1H", 3),
  washLowTxnPenalty: readUnit("TRENDING_WASH_LOW_TXN_PENALTY", 0.25),
  washMaxAvgTradeUsd: readUsd("TRENDING_WASH_MAX_AVG_TRADE_USD", 75_000),
  washWhalePenalty: readUnit("TRENDING_WASH_WHALE_PENALTY", 0.35),
  washExcludeBelow: readUnit("TRENDING_WASH_EXCLUDE_BELOW", 0.05),
};
