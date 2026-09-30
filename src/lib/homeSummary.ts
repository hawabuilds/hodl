import type {ChartPoint, FeedItem, RwaAsset, Timeframe, TokenAsset} from "./types";

/**
 * The choices behind Home's summary, kept pure so they can be tested apart
 * from the page.
 */

const DAY = 24 * 60 * 60_000;

export const FEATURED_RANGES = ["1D", "1W", "1M", "1Y"] as const;
export type FeaturedRange = (typeof FEATURED_RANGES)[number];

/**
 * Where each range's line comes from.
 *
 * The RWA chart route serves candles (5m, 1h, 1D), not ranges, so each range
 * reads the finest candles that cover it and is cut to length: 5m holds about
 * a week, 1h about a month, 1D a year.
 */
export const RANGE_SOURCE: Record<FeaturedRange, {timeframe: Timeframe; spanMs: number}> = {
  "1D": {timeframe: "5m", spanMs: DAY},
  "1W": {timeframe: "1h", spanMs: 7 * DAY},
  "1M": {timeframe: "1h", spanMs: 30 * DAY},
  "1Y": {timeframe: "1D", spanMs: 365 * DAY},
};

/**
 * The last `spanMs` of a series, measured back from its newest point rather
 * than from now — so on a weekend, 1D is Friday's session instead of nothing.
 */
export function sliceToRange(points: readonly ChartPoint[], spanMs: number): ChartPoint[] {
  const last = points[points.length - 1];
  if (!last) return [];
  const from = last.t - spanMs;
  return points.filter((point) => point.t >= from);
}

export interface FeaturedRwa {
  rwa: RwaAsset;
  /** 24h volume across the tokens paired with it, in USD. */
  tokenVolumeUsd: number;
  /** Its paired tokens, busiest first, at most four. */
  paired: TokenAsset[];
}

/**
 * The RWA whose paired tokens traded most in the last day.
 *
 * Summed over the tokens the market list carries, which is the busiest ones;
 * a long tail of quiet tokens cannot change which RWA leads.
 */
export function featuredRwa(
  tokens: readonly TokenAsset[],
  rwas: readonly RwaAsset[],
): FeaturedRwa | null {
  const byTicker = new Map(rwas.map((rwa) => [rwa.ticker, rwa]));
  const volume = new Map<string, number>();
  for (const token of tokens) {
    if (!byTicker.has(token.pairedTicker)) continue;
    volume.set(token.pairedTicker, (volume.get(token.pairedTicker) ?? 0) + (token.volume24hUsd ?? 0));
  }

  let lead: string | null = null;
  for (const [ticker, total] of volume) {
    if (total > 0 && (lead === null || total > (volume.get(lead) ?? 0))) lead = ticker;
  }
  if (lead === null) return null;

  return {
    rwa: byTicker.get(lead)!,
    tokenVolumeUsd: volume.get(lead) ?? 0,
    paired: tokens
      .filter((token) => token.pairedTicker === lead)
      .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
      .slice(0, 4),
  };
}

/**
 * The newest stories about the given RWAs, topped up with the newest stories
 * about any RWA when there are not enough.
 */
export function newsForTickers(
  items: readonly FeedItem[],
  tickers: ReadonlySet<string>,
  count = 3,
): FeedItem[] {
  const newest = items
    .filter((item) => item.kind === "article" && item.tickers.length > 0)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const about = newest.filter((item) => item.tickers.some((ticker) => tickers.has(ticker)));
  const rest = newest.filter((item) => !about.includes(item));
  return [...about, ...rest].slice(0, count);
}
