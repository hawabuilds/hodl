import type {
  Asset,
  AssetKind,
  ChartPoint,
  FeedItem,
  NewsItem,
  Profile,
  RwaAsset,
  Timeframe,
  TokenAsset,
  Trade,
} from "@/lib/types";
import * as seeded from "./market";
import * as live from "./live/market";
import * as gecko from "./live/geckoterminal";
import {feedFor, type FeedQuery} from "./newsfeed";
import {searchPeople} from "./social";

/**
 * The seam between the app and its data.
 *
 * Every route reads through this module and nothing else, so wiring a real feed
 * is a one-function change here rather than a sweep through the UI. Each
 * adapter documents the source it is waiting on and falls through to the seeded
 * market until that source exists.
 *
 * The seeded market is not scaffolding to be deleted: keep it as the fallback
 * when a provider is down or unconfigured, the way Pick falls back to demo data.
 */

export interface SourceResult<T> {
  data: T;
  /** True while the value came from the seeded market rather than a live feed. */
  seeded: boolean;
}

/**
 * Falls back to the seeded market when a live source is empty or throws.
 *
 * `seeded` on the result is what the UI reads to decide whether to caveat the
 * numbers, so it has to stay honest: true means nothing on screen came from a
 * real market.
 */
async function liveOr<T>(
  load: () => Promise<T[]>,
  fallback: () => T[],
): Promise<SourceResult<T[]>> {
  try {
    const data = await load();
    if (data.length > 0) return {data, seeded: false};
  } catch (error) {
    console.error("live source failed, falling back to seeded", error);
  }
  return {data: fallback(), seeded: true};
}

/**
 * Official Robinhood tokenized assets.
 *
 * Live. `rwaRegistry.json` names them and Robinhood's own quote endpoint prices
 * them. Deliberately not priced from pools: measured against these quotes, pool
 * prices run a median 5.5% out, because two thirds of those pools hold under
 * $10k.
 *
 * TODO(live): the registry is a snapshot in the repo, so a new listing needs a
 * rebuild. Part 04 step 1 has the weekly refresh that removes that.
 */
export async function fetchRwas(): Promise<SourceResult<RwaAsset[]>> {
  return liveOr(live.listRwas, seeded.listRwas);
}

/**
 * Tokens whose liquidity pool is paired against a tokenized RWA.
 *
 * Live, from DexScreener, enumerated from the RWA side so the set is complete
 * by construction — a token with an RWA pair cannot hide, because the pair is
 * what makes it visible.
 *
 * TODO(live): holders, transfer taxes and honeypot detection all need an RPC
 * and are still zero. Part 05 step 4.
 */
export async function fetchTokens(): Promise<SourceResult<TokenAsset[]>> {
  return liveOr(live.listTokens, seeded.listTokens);
}

export async function fetchAsset(
  kind: AssetKind,
  id: string,
): Promise<SourceResult<Asset | null>> {
  try {
    const data = await live.getAsset(kind, id);
    if (data) return {data, seeded: false};
  } catch (error) {
    console.error("live asset lookup failed", error);
  }
  return {data: seeded.getAsset(kind, id), seeded: true};
}

/**
 * Candles, from GeckoTerminal's index of this chain.
 *
 * Not scanned from `Swap` logs: the RPC plan in use caps `eth_getLogs` at a
 * ten-block range, and a backfill would run to millions of requests. Their
 * daily series reaches back to the chain's first day, so a chart is complete
 * the first time it is opened.
 */
export async function fetchChart(
  asset: Asset,
  timeframe: Timeframe,
): Promise<SourceResult<ChartPoint[]>> {
  try {
    const target = await live.poolFor(asset.kind, asset.id);
    if (target) {
      const points = await gecko.candles(target.pool, timeframe);
      if (points.length > 1) return {data: points, seeded: false};
    }
  } catch (error) {
    console.error("live chart failed", error);
  }
  return {data: seeded.chartFor(asset, timeframe), seeded: true};
}

/**
 * Recent fills for the asset's deepest pool, newest first.
 *
 * Same source and the same reason as the chart. GeckoTerminal returns the last
 * 300 swaps per pool, which is far more tape than the panel shows.
 */
export async function fetchTrades(
  asset: Asset,
  limit?: number,
): Promise<SourceResult<Trade[]>> {
  try {
    const target = await live.poolFor(asset.kind, asset.id);
    if (target) {
      const rows = await gecko.trades(target.pool, target.token, limit ?? 40);
      if (rows.length > 0) return {data: rows, seeded: false};
    }
  } catch (error) {
    console.error("live trades failed", error);
  }
  return {data: seeded.tradesFor(asset, limit), seeded: true};
}

/**
 * TODO(live): a headline provider keyed by ticker. Until then the route flags
 * the response as sample data and the UI says so.
 */
export async function fetchNews(
  asset: RwaAsset,
): Promise<SourceResult<NewsItem[]>> {
  return {data: seeded.newsFor(asset), seeded: true};
}

/**
 * TODO(live): the chain's own ETH/USD oracle. The order sheet reads this to
 * convert between the two currencies someone can size a trade in.
 */
export async function fetchEthPrice(): Promise<SourceResult<number>> {
  return {data: seeded.ethPriceUsd(), seeded: true};
}

export async function search(query: string): Promise<SourceResult<Asset[]>> {
  try {
    // An empty result is a real answer to a search, not a failure, so only a
    // throw falls back to seeded data.
    return {data: await live.searchAssets(query), seeded: false};
  } catch (error) {
    console.error("live search failed", error);
    return {data: seeded.searchAssets(query), seeded: true};
  }
}

/**
 * TODO(live): the same Supabase `users` table the profiles come from, matched
 * on handle and display name.
 */
export async function searchUsers(
  query: string,
): Promise<SourceResult<Profile[]>> {
  return {data: searchPeople(query), seeded: true};
}

/**
 * The news tab.
 *
 * TODO(live): a headline provider keyed by ticker for the coverage, and the X
 * API for the Robinhood accounts. `seeded` is what the UI reads to decide
 * whether to caveat the feed.
 */
export async function fetchFeed(
  query: FeedQuery,
): Promise<SourceResult<FeedItem[]>> {
  return {data: feedFor(query), seeded: true};
}
