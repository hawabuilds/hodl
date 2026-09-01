import type {
  Asset,
  AssetKind,
  ChartPoint,
  NewsItem,
  RwaAsset,
  Timeframe,
  TokenAsset,
  Trade,
} from "@/lib/types";
import * as seeded from "./market";

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
 * Official Robinhood tokenized assets.
 *
 * TODO(live): Robinhood Chain publishes its asset registry at `/rhj/assets`;
 * pair it with Chainlink stock feeds on mainnet for price, exactly as the Pick
 * app does in `lib/server/universe.ts` and `lib/server/rhprices.ts`. Sector,
 * stock type and description are not in the registry and stay local.
 */
export async function fetchRwas(): Promise<SourceResult<RwaAsset[]>> {
  return {data: seeded.listRwas(), seeded: true};
}

/**
 * Tokens whose liquidity pool is paired against a tokenized RWA.
 *
 * TODO(live): enumerate pools on the chain's DEX factory, keep the ones whose
 * other side is a known RWA token address, then read reserves for price and
 * liquidity. Launchpad attribution comes from the deployer address; socials and
 * images come from whichever launchpad API owns the token.
 */
export async function fetchTokens(): Promise<SourceResult<TokenAsset[]>> {
  return {data: seeded.listTokens(), seeded: true};
}

export async function fetchAsset(
  kind: AssetKind,
  id: string,
): Promise<SourceResult<Asset | null>> {
  return {data: seeded.getAsset(kind, id), seeded: true};
}

/**
 * TODO(live): candles from the pool's swap events, bucketed to the timeframe.
 * For RWAs, the on-chain oracle round history gives the same shape.
 */
export async function fetchChart(
  asset: Asset,
  timeframe: Timeframe,
): Promise<SourceResult<ChartPoint[]>> {
  return {data: seeded.chartFor(asset, timeframe), seeded: true};
}

/**
 * TODO(live): decoded Swap logs for the pool, newest first, with the maker
 * resolved back to an app profile where one exists.
 */
export async function fetchTrades(
  asset: Asset,
  limit?: number,
): Promise<SourceResult<Trade[]>> {
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

export async function search(query: string): Promise<SourceResult<Asset[]>> {
  return {data: seeded.searchAssets(query), seeded: true};
}
