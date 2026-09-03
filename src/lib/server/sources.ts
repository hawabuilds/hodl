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
import {AUTHENTICATED} from "./live/geckoterminal";
import * as swaps from "./live/swaps";
import * as headlines from "./live/news";
import {compareTradesNewestFirst} from "@/lib/tradeOrder";
import {quotePriceUsd} from "@/lib/server/quotePrice";
import {underFeature} from "./live/rpcMeter";
import {feedFor, type FeedQuery} from "./newsfeed";
import {hasDatabase} from "./db";
import {searchPeople} from "./social";
import {searchUsers as searchUsersLive} from "./social-live";

const TRADES_LIMIT = 300;

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
  return underFeature("feed", () => liveOr(live.listTokens, seeded.listTokens));
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
 * Everything a chart page reads on first paint, in one server round trip.
 *
 * Resolves the asset once, then loads chart and trades against the same cached
 * pool — three separate routes used to each rebuild the full token list.
 */
export async function fetchAssetPage(
  kind: AssetKind,
  id: string,
  timeframe: Timeframe,
): Promise<
  SourceResult<{
    asset: Asset;
    chart: {timeframe: Timeframe; points: ChartPoint[]; changePct: number};
    trades: {trades: Trade[]; pollMs: number};
  } | null>
> {
  const assetResult = await fetchAsset(kind, id);
  if (!assetResult.data) return {data: null, seeded: assetResult.seeded};

  const [chartResult, tradesResult] = await Promise.all([
    fetchChart(assetResult.data, timeframe, assetResult.seeded),
    fetchTrades(assetResult.data, 300, assetResult.seeded),
  ]);

  const first = chartResult.data[0]?.price ?? 0;
  const last = chartResult.data[chartResult.data.length - 1]?.price ?? 0;

  return {
    data: {
      asset: assetResult.data,
      chart: {
        timeframe,
        points: chartResult.data,
        changePct:
          first > 0
            ? Number((((last - first) / first) * 100).toFixed(2))
            : 0,
      },
      trades: {
        trades: tradesResult.data,
        pollMs:
          process.env.ALCHEMY_RPC_URL || AUTHENTICATED ? 2_000 : 12_000,
      },
    },
    seeded: assetResult.seeded || chartResult.seeded || tradesResult.seeded,
  };
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
  /**
   * Whether the asset itself is simulated. A real token must never be given a
   * made-up history — see the note below.
   */
  assetIsSeeded = true,
): Promise<SourceResult<ChartPoint[]>> {
  try {
    const target = await live.poolFor(asset.kind, asset.id);
    if (target) {
      const points = await gecko.candles(target.pool, timeframe, target.token);
      if (points.length > 1) return {data: points, seeded: false};
    }
  } catch (error) {
    console.error("live chart failed", error);
  }

  /**
   * A real token with no candles gets an empty chart, not an invented one.
   *
   * The simulated series is a random walk anchored to the current clock, so
   * for a live token it did three wrong things at once: it drew prices in the
   * wrong range entirely — a fifth of a cent against a real four ten-thousandths
   * — it redrew itself on every poll, which is what made charts flicker between
   * red and green, and scrubbing it multiplied a fictional price by the real
   * supply and reported market caps in the billions. None of that is better
   * than an honest empty chart, and a token that has actually traded now has
   * candles to show since the bucket ladder above reaches its first minutes.
   */
  if (!assetIsSeeded) return {data: [], seeded: false};

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
  /** As with the chart: a real token gets an empty tape, never a fake one. */
  assetIsSeeded = true,
): Promise<SourceResult<Trade[]>> {
  try {
    const target = await live.poolFor(asset.kind, asset.id);
    if (target) {
      const cap = limit ?? TRADES_LIMIT;
      const quoteUsd = target.quote
        ? await quotePriceUsd(target.quote)
        : null;

      const [indexed, live_] = await Promise.all([
        gecko.trades(target.pool, target.token, cap),
        target.quote
          ? swaps
              .recentSwaps(
                target.pool,
                target.token,
                target.quote,
                asset.priceUsd,
                quoteUsd,
              )
              .catch(() => [] as Trade[])
          : Promise.resolve([] as Trade[]),
      ]);

      const byId = new Map<string, Trade>();
      for (const trade of indexed) byId.set(trade.id.toLowerCase(), trade);
      for (const trade of live_) {
        const key = trade.id.toLowerCase();
        if (!byId.has(key)) byId.set(key, trade);
      }
      if (byId.size === 0 && live_.length > 0) {
        for (const trade of live_) byId.set(trade.id.toLowerCase(), trade);
      }

      const merged = [...byId.values()].sort(compareTradesNewestFirst);

      return {data: merged.slice(0, cap), seeded: false};
    }
  } catch (error) {
    console.error("live trades failed", error);
  }

  // Fabricated fills carry fake maker addresses and fake transaction hashes,
  // which on a real token's page read as a record of trades that never
  // happened. An empty tape is the truthful answer.
  if (!assetIsSeeded) return {data: [], seeded: false};

  return {data: seeded.tradesFor(asset, limit), seeded: true};
}

/**
 * Coverage for one stock token, on its chart page.
 *
 * Real wire copy from Finnhub. `seeded` going false is what removes the
 * "sample headlines" banner the panel shows.
 */
export async function fetchNews(
  asset: RwaAsset,
): Promise<SourceResult<NewsItem[]>> {
  try {
    const items = await headlines.newsForTicker(asset.ticker);
    if (items.length > 0) {
      return {
        data: items.map((item) => ({
          id: item.id,
          title: item.body,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
        })),
        seeded: false,
      };
    }
  } catch (error) {
    console.error("live news failed", error);
  }
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
  return underFeature("search", async () => {
  try {
    // An empty result is a real answer to a search, not a failure, so only a
    // throw falls back to seeded data.
    return {data: await live.searchAssets(query), seeded: false};
  } catch (error) {
    console.error("live search failed", error);
    return {data: seeded.searchAssets(query), seeded: true};
  }
  });
}

/**
 * People, from the same Supabase `users` table the profiles come from.
 *
 * Falls back to the seeded cast only when the database is unconfigured or the
 * query throws — an empty live result is a real "nobody matches", not a reason
 * to invent twelve personas.
 */
export async function searchUsers(
  query: string,
): Promise<SourceResult<Profile[]>> {
  if (hasDatabase) {
    try {
      return {data: await searchUsersLive(query), seeded: false};
    } catch (error) {
      console.error("live people search failed", error);
    }
  }
  return {data: searchPeople(query), seeded: true};
}

/**
 * The news tab.
 *
 * Company news per ticker for the RWA side, and HOOD's own coverage for the
 * Robinhood side — a better filter than a keyword match, because it is what the
 * wires already tag.
 *
 * TODO(live): the account cards still carry no post text. That is deliberate
 * until the X API is wired: inventing words beside a real person's name and a
 * verified tick would be a fabricated record however the feed is labelled.
 */
export async function fetchFeed(
  query: FeedQuery,
): Promise<SourceResult<FeedItem[]>> {
  try {
    const items = await headlines.feed(query.window, query.topic);
    // A wire failure shows up as a feed with no articles in it, so a result
    // that should carry headlines but does not falls through to seeded. The
    // Posts tab is the exception: it is account posts by definition, and
    // demanding an article there sent every real post back to the seeded feed.
    const wireOk =
      query.topic === "posts"
        ? items.length > 0
        : items.some((item) => item.kind === "article");
    if (wireOk) return {data: items, seeded: false};
  } catch (error) {
    console.error("live feed failed", error);
  }
  return {data: feedFor(query), seeded: true};
}
