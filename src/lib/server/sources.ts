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
import * as live from "./live/market";
import * as gecko from "./live/geckoterminal";
import {historicalCandles} from "./live/robinhood";
import * as swaps from "./live/swaps";
import * as headlines from "./live/news";
import {compareTradesNewestFirst} from "@/lib/tradeOrder";
import {quotePriceUsd} from "@/lib/server/quotePrice";
import {reorientPoints} from "@/lib/pairOrientation";
import {underFeature} from "./live/rpcMeter";
import {type FeedQuery} from "./newsfeed";
import {hasDatabase} from "./db";
import {normalizeAddress} from "@/lib/address";
import {searchPeople} from "./social";
import {searchUsers as searchUsersLive} from "./social-live";

const TRADES_LIMIT = 300;

/**
 * The seam between the app and its data.
 *
 * Production never invents tokens, charts, or people. A live miss is empty
 * or an error. The seeded module stays for local-unconfigured social/demo
 * routes that have no database — not for market rows.
 */

export interface SourceResult<T> {
  data: T;
  /** True while the value came from the seeded market rather than a live feed. */
  seeded: boolean;
  /** Set when the provider failed. Empty data without this is a real empty set. */
  error?: string;
}

async function liveOnly<T>(load: () => Promise<T>): Promise<SourceResult<T>> {
  const data = await load();
  return {data, seeded: false};
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
  return liveOnly(live.listRwas);
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
  return underFeature("feed", () => liveOnly(live.listTokens));
}

function assetId(kind: AssetKind, id: string): string {
  return kind === "token" ? normalizeAddress(id) : id;
}

export async function fetchAsset(
  kind: AssetKind,
  id: string,
): Promise<SourceResult<Asset | null>> {
  try {
    const data = await live.getAsset(kind, assetId(kind, id));
    return {data, seeded: false};
  } catch (error) {
    console.error("live asset lookup failed", error);
    throw error;
  }
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
    chart: {
      timeframe: Timeframe;
      points: ChartPoint[];
      changePct: number;
      error?: string | null;
    };
    trades: {trades: Trade[]; pollMs: number; error?: string | null};
  } | null>
> {
  const assetResult = await fetchAsset(kind, assetId(kind, id));
  if (!assetResult.data) return {data: null, seeded: assetResult.seeded};

  const [chartSettled, tradesSettled] = await Promise.allSettled([
    fetchChart(assetResult.data, timeframe, assetResult.seeded),
    fetchTrades(assetResult.data, 300, assetResult.seeded),
  ]);
  const chartResult =
    chartSettled.status === "fulfilled"
      ? chartSettled.value
      : {data: [] as ChartPoint[], seeded: false, error: "Could not load the chart."};
  const tradesResult =
    tradesSettled.status === "fulfilled"
      ? tradesSettled.value
      : {data: [] as Trade[], seeded: false, error: "Could not load trades."};

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
        error: chartResult.error ?? null,
      },
      trades: {
        trades: tradesResult.data,
        pollMs: process.env.ALCHEMY_RPC_URL ? 2_000 : 12_000,
        error: tradesResult.error ?? null,
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
  if (asset.kind === "rwa") {
    try {
      const points = await historicalCandles(asset.ticker, timeframe);
      if (points.length > 1) return {data: points, seeded: false};
    } catch (error) {
      console.error("rwa chart failed", error);
      return {
        data: [],
        seeded: false,
        error: "Could not load the chart.",
      };
    }
    return {data: [], seeded: false};
  }

  try {
    const target = await live.poolFor(asset.kind, asset.id);
    if (target) {
      const side = target.tokenIsBase === false ? "quote" : "base";
      const raw = await gecko.candles(target.pool, timeframe, side);
      const points = reorientPoints(
        raw.points,
        asset.priceUsd,
        asset.liquidityUsd ?? 0,
        asset.symbol,
      );
      if (points.length > 1) return {data: points, seeded: false};
      if (raw.error) {
        return {data: [], seeded: false, error: raw.error};
      }
    }
  } catch (error) {
    console.error("live chart failed", error);
    return {data: [], seeded: false, error: "Could not load the chart."};
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
  return {data: [], seeded: false};
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

      const [indexedSettled, liveSettled] = await Promise.allSettled([
        gecko.trades(target.pool, target.token, cap),
        target.quote && asset.priceUsd != null && asset.priceUsd > 0
          ? swaps.recentSwaps(
              target.pool,
              target.token,
              target.quote,
              asset.priceUsd,
              quoteUsd,
            )
          : Promise.resolve([] as Trade[]),
      ]);

      const indexed =
        indexedSettled.status === "fulfilled" ? indexedSettled.value : null;
      const live_ =
        liveSettled.status === "fulfilled" ? liveSettled.value : [];
      const geckoDown =
        indexedSettled.status === "rejected" || Boolean(indexed?.error);
      const alchemyDown = liveSettled.status === "rejected";

      const byId = new Map<string, Trade>();
      for (const trade of indexed?.trades ?? []) {
        byId.set(trade.id.toLowerCase(), trade);
      }
      for (const trade of live_) {
        const key = trade.id.toLowerCase();
        if (!byId.has(key)) byId.set(key, trade);
      }

      const merged = [...byId.values()].sort(compareTradesNewestFirst);
      if (merged.length > 0) {
        return {data: merged.slice(0, cap), seeded: false};
      }
      if (geckoDown && alchemyDown) {
        return {data: [], seeded: false, error: "Could not load trades."};
      }
      if (geckoDown && live_.length === 0 && !alchemyDown) {
        return {data: [], seeded: false};
      }
      return {data: [], seeded: false};
    }
  } catch (error) {
    console.error("live trades failed", error);
    return {data: [], seeded: false, error: "Could not load trades."};
  }

  // Fabricated fills carry fake maker addresses and fake transaction hashes,
  // which on a real token's page read as a record of trades that never
  // happened. An empty tape is the truthful answer.
  return {data: [], seeded: false};
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
    return {data: [], seeded: false, error: "Could not load news."};
  }
  return {data: [], seeded: false};
}

/**
 * TODO(live): the chain's own ETH/USD oracle. The order sheet reads this to
 * convert between the two currencies someone can size a trade in.
 */
export async function fetchEthPrice(): Promise<SourceResult<number>> {
  try {
    const {pairsForToken} = await import("./live/dexscreener");
    const {QUOTE_WETH} = await import("@/lib/contracts");
    const pairs = await pairsForToken(QUOTE_WETH);
    const usd = Number(pairs[0]?.priceUsd ?? 0);
    if (Number.isFinite(usd) && usd > 0) return {data: usd, seeded: false};
  } catch (error) {
    console.error("live eth price failed", error);
  }
  return {data: 0, seeded: false};
}

export async function search(query: string): Promise<SourceResult<Asset[]>> {
  return underFeature("search", async () => {
    try {
      if (hasDatabase) {
        const {searchUniverse} = await import("./live/search");
        const grouped = await searchUniverse(query, []);
        return {data: grouped.results, seeded: false};
      }
      return {data: await live.searchAssets(query), seeded: false};
    } catch (error) {
      console.error("live search failed", error);
      throw error;
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
      throw error;
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
    return {data: items, seeded: false};
  } catch (error) {
    console.error("live feed failed", error);
    throw error;
  }
}
