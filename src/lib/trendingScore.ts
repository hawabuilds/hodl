import {
  TRENDING_MIN_LIQUIDITY_USD,
  TRENDING_MIN_MARKET_CAP_USD,
  TRENDING_WEIGHTS,
  type TrendingWeights,
} from "@/config/trending";
import {isUserBound, meetsBound} from "@/lib/priceState";
import type {FeedWindow, TokenAsset} from "@/lib/types";

export interface TrendingWindowStats {
  volumeUsd: number;
  changePct: number;
  buys?: number;
  sells?: number;
}

export interface TrendingBoundOpts {
  minMarketCap?: number | null;
  maxMarketCap?: number | null;
  minLiquidity?: number | null;
  maxLiquidity?: number | null;
}

/** Default Trending floors unless the user set an explicit bound. */
export function effectiveTrendingBounds(
  opts: TrendingBoundOpts = {},
): Required<Pick<TrendingBoundOpts, "minMarketCap" | "minLiquidity">> & {
  maxMarketCap: number | null;
  maxLiquidity: number | null;
} {
  return {
    minMarketCap: isUserBound(opts.minMarketCap, opts.maxMarketCap)
      ? (opts.minMarketCap ?? null)
      : TRENDING_MIN_MARKET_CAP_USD,
    maxMarketCap: opts.maxMarketCap ?? null,
    minLiquidity: isUserBound(opts.minLiquidity, opts.maxLiquidity)
      ? (opts.minLiquidity ?? null)
      : TRENDING_MIN_LIQUIDITY_USD,
    maxLiquidity: opts.maxLiquidity ?? null,
  };
}

export function passesTrendingFloors(
  token: Pick<TokenAsset, "marketCapUsd" | "liquidityUsd" | "tradeable">,
  opts: TrendingBoundOpts = {},
): boolean {
  if (token.tradeable === false) return false;
  const bounds = effectiveTrendingBounds(opts);
  if (
    !meetsBound(
      token.marketCapUsd,
      bounds.minMarketCap,
      bounds.maxMarketCap,
    )
  ) {
    return false;
  }
  if (
    !meetsBound(
      token.liquidityUsd,
      bounds.minLiquidity,
      bounds.maxLiquidity,
    )
  ) {
    return false;
  }
  return true;
}

function windowStats(
  windows: TokenAsset["windows"],
  key: FeedWindow,
): TrendingWindowStats {
  const row = windows[key];
  return {
    volumeUsd: row?.volumeUsd ?? 0,
    changePct: row?.changePct ?? 0,
    buys: row?.buys,
    sells: row?.sells,
  };
}

/**
 * Momentum score for Trending.
 *
 * Ranks recent volume *surge* (1h vs a flat 24h pace) ahead of raw 24h
 * volume so a smaller token doing 5× its normal hour beats a large cap
 * ticking along at 1×.
 */
export function trendingMomentumScore(
  windows: TokenAsset["windows"],
  weights: TrendingWeights = TRENDING_WEIGHTS,
): number {
  const w24 = windowStats(windows, "24h");
  const w6 = windowStats(windows, "6h");
  const w1 = windowStats(windows, "1h");

  const baselineHourly = Math.max(
    w24.volumeUsd / 24,
    weights.minBaselineHourlyUsd,
  );
  const surge1h = w1.volumeUsd / baselineHourly;
  const surge6h = w6.volumeUsd / 6 / baselineHourly;

  const volumeScore =
    weights.weight1h * Math.log1p(surge1h) +
    weights.weight6h * Math.log1p(surge6h) +
    weights.weight24h *
      Math.log1p(w24.volumeUsd / Math.max(weights.minBaseline24hUsd, 1));

  const buys1h = w1.buys ?? 0;
  const sells1h = w1.sells ?? 0;
  const txns1h = buys1h + sells1h;
  const buyerScore = Math.log1p(buys1h + sells1h * 0.35);
  const priceScore = Math.min(Math.abs(w1.changePct) / 10, 1);

  let washMultiplier = 1;
  if (w1.volumeUsd >= weights.washMinVolumeUsd) {
    if (txns1h < weights.washMinTxns1h) {
      washMultiplier = weights.washLowTxnPenalty;
    } else {
      const avgTrade = w1.volumeUsd / txns1h;
      if (avgTrade > weights.washMaxAvgTradeUsd) {
        washMultiplier = Math.min(
          washMultiplier,
          weights.washWhalePenalty,
        );
      } else if (buys1h < weights.washMinBuys1h) {
        washMultiplier = Math.min(
          washMultiplier,
          weights.washLowTxnPenalty,
        );
      }
    }
  }

  const raw =
    volumeScore *
    (1 + weights.buyerBoost * buyerScore) *
    (1 + weights.priceBoost * priceScore) *
    washMultiplier;

  if (raw < weights.washExcludeBelow) return 0;
  return raw;
}

export function compareTrendingMomentum(a: TokenAsset, b: TokenAsset): number {
  return (
    trendingMomentumScore(b.windows) - trendingMomentumScore(a.windows) ||
    (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)
  );
}

export function rankTrendingTokens(
  tokens: TokenAsset[],
  opts: TrendingBoundOpts = {},
): TokenAsset[] {
  return tokens
    .filter((token) => passesTrendingFloors(token, opts))
    .sort(compareTrendingMomentum);
}
