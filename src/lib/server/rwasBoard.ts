import {
  RWAS_PAGE_SIZE,
  RWA_CATEGORIES,
  categoriesFor,
  shortCompanyName,
  sortRwaRows,
  topMovers,
  type RwaBoardPage,
  type RwaBoardRow,
  type RwaCategory,
  type RwaNewsItem,
  type RwaPost,
  type RwaSort,
  type RwasOverview,
} from "@/lib/rwaBoard";
import type {RwaSession} from "@/lib/rwaMove";
import type {SectorId} from "@/lib/sectors";
import {anchorDayLine} from "@/lib/spark";
import type {FeedItem} from "@/lib/types";
import {db, hasDatabase} from "./db";
import {cached, stale} from "./live/cache";
import {feed} from "./live/news";
import {companyMarketCaps, intradayLines, stockMoves, thinSeries} from "./live/rhMarket";
import {quotes, RWA_BY_ADDRESS, RWA_REGISTRY} from "./live/robinhood";
import {posts} from "./live/x";

/**
 * The desktop RWAs page, assembled on the server.
 *
 * 195 stocks is small enough to hold whole: every source below is one cached
 * batch, the rows are built once, and sorting and paging happen in memory.
 */

const PAIR_TTL_MS = 2 * 60_000;

interface PairStat {
  tokens: number;
  volumeUsd: number;
}

function missingFunction(error: {code?: string; message?: string} | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || /hodl_rwa_pair_stats/i.test(error.message ?? "")));
}

let pairSqlWarned = false;

/**
 * Tokens that traded in the last 24h paired with each stock, and their
 * volume, from scripts/schema-rwas-tab.sql. Until that is run the list shows
 * no counts: the Tokens tab's older count function takes ~4s over this set,
 * past the API's statement timeout, and would stall every page.
 */
async function pairStats(): Promise<Record<string, PairStat>> {
  if (!hasDatabase) return {};
  const key = "rwas:pair-stats:v1";
  const load = async (): Promise<Record<string, PairStat>> => {
    const out: Record<string, PairStat> = {};
    const {data, error} = await db().rpc("hodl_rwa_pair_stats");
    if (missingFunction(error)) {
      if (!pairSqlWarned) console.warn("rwas: run scripts/schema-rwas-tab.sql for paired-token counts");
      pairSqlWarned = true;
      return out;
    }
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as {quote_token: string; tokens: number; vol_24h: number}[]) {
      const ticker = RWA_BY_ADDRESS.get(row.quote_token.toLowerCase())?.ticker;
      if (ticker) out[ticker] = {tokens: Number(row.tokens) || 0, volumeUsd: Number(row.vol_24h) || 0};
    }
    return out;
  };
  try {
    return await cached(key, PAIR_TTL_MS, load);
  } catch (error) {
    console.warn("rwas pair stats failed", error instanceof Error ? error.message : error);
    return stale<Record<string, PairStat>>(key) ?? {};
  }
}

const round = (value: number, places: number) => Number(value.toFixed(places));

/** Every RWA as a board row, plus whether the moves are today's or the last session's. */
export async function boardRows(): Promise<{rows: RwaBoardRow[]; session: RwaSession}> {
  const [tokenQuotes, moves, lines, caps, pairs] = await Promise.all([
    quotes().catch(() => new Map()),
    stockMoves(),
    intradayLines(),
    companyMarketCaps(),
    pairStats(),
  ]);
  const rows = RWA_REGISTRY.map((entry): RwaBoardRow => {
    const quote = tokenQuotes.get(entry.ticker);
    const move = moves.moves[entry.ticker];
    const pair = pairs[entry.ticker];
    const price = move?.priceUsd ?? quote?.priceUsd ?? null;
    return {
      ticker: entry.ticker,
      id: entry.ticker.toLowerCase(),
      name: shortCompanyName(entry.name),
      logoUrl: entry.logoUrl,
      categories: categoriesFor(entry.ticker, (entry.sector ?? "software") as SectorId),
      priceUsd: price != null ? round(price, 4) : null,
      changePct: move ? round(move.changePct, 2) : null,
      series: anchorDayLine(thinSeries(lines[entry.ticker] ?? []), price, move?.changePct ?? null).map((v) => round(v, 4)),
      volumeUsd: quote && quote.volume24hUsd > 0 ? Math.round(quote.volume24hUsd) : null,
      marketCapUsd: caps[entry.ticker] ?? null,
      chainVolumeUsd: quote ? Math.round(quote.chainVolumeUsd) : null,
      pairedTokens: pair?.tokens ?? 0,
      pairedVolumeUsd: Math.round(pair?.volumeUsd ?? 0),
    };
  });
  return {rows, session: moves.session};
}

export function categoryCounts(rows: RwaBoardRow[]): Record<RwaCategory | "all", number> {
  const counts = {all: rows.length} as Record<RwaCategory | "all", number>;
  for (const category of RWA_CATEGORIES) {
    counts[category.id] = rows.filter((row) => row.categories.includes(category.id)).length;
  }
  return counts;
}

/** One page of the list: All or the stocks on the watchlist, a category, a sort. */
export async function rwasBoardPage(input: {
  tab: "all" | "watchlist";
  category: RwaCategory | "all";
  sort: RwaSort;
  offset: number;
  watch: string[];
}): Promise<RwaBoardPage> {
  const {rows, session} = await boardRows();
  const watched = new Set(input.watch.map((ticker) => ticker.toUpperCase()));
  const scoped = input.tab === "watchlist" ? rows.filter((row) => watched.has(row.ticker)) : rows;
  const filtered = input.category === "all" ? scoped : scoped.filter((row) => row.categories.includes(input.category as RwaCategory));
  const sorted = sortRwaRows(filtered, input.sort);
  const offset = Math.max(0, Math.floor(input.offset));
  const page = sorted.slice(offset, offset + RWAS_PAGE_SIZE);
  const next = offset + RWAS_PAGE_SIZE < sorted.length ? offset + RWAS_PAGE_SIZE : null;
  return {
    rows: page,
    next,
    total: sorted.length,
    session,
    ...(offset === 0 ? {counts: categoryCounts(scoped)} : {}),
  };
}

const POSTS_SHOWN = 6;
const NEWS_SHOWN = 5;

function toPost(item: FeedItem): RwaPost {
  return {
    id: item.id,
    name: item.source,
    handle: item.handle ?? "",
    avatarUrl: item.avatarUrl,
    text: item.body,
    url: item.url,
    publishedAt: item.publishedAt,
  };
}

/** Movers, Robinhood's posts and the latest stock news, for the page's main column. */
export async function rwasOverview(): Promise<RwasOverview> {
  const [{rows, session}, accountPosts, stories] = await Promise.all([
    boardRows(),
    posts().catch(() => [] as FeedItem[]),
    feed("7d", "rwa").catch(() => [] as FeedItem[]),
  ]);
  const byTicker = new Map(rows.map((row) => [row.ticker, row]));
  const news = stories
    .filter((item) => item.kind === "article" && item.tickers.some((ticker) => byTicker.has(ticker)))
    .slice(0, NEWS_SHOWN)
    .map((item): RwaNewsItem => {
      const ticker = item.tickers.find((entry) => byTicker.has(entry)) ?? null;
      return {
        id: item.id,
        source: item.source,
        headline: item.body,
        publishedAt: item.publishedAt,
        imageUrl: item.imageUrl,
        ticker,
        logoUrl: ticker ? (byTicker.get(ticker)?.logoUrl ?? null) : null,
        changePct: ticker ? (byTicker.get(ticker)?.changePct ?? null) : null,
      };
    });
  return {
    session,
    moves: Object.fromEntries(rows.map((row) => [row.ticker, {priceUsd: row.priceUsd, changePct: row.changePct}])),
    movers: {up: topMovers(rows, "up"), down: topMovers(rows, "down")},
    posts: accountPosts.filter((item) => item.kind === "account").slice(0, POSTS_SHOWN).map(toPost),
    news,
  };
}
