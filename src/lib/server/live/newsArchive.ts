import {NEWS_WINDOW_MS} from "@/lib/newsWindow";
import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";
import {db, hasDatabase} from "../db";

/**
 * Persisted Finnhub wire copy. Metadata and teaser summary only — no publisher HTML.
 *
 * Rows accumulate on each wire build; longer windows read from here when the
 * in-memory cache has rolled off. Optional cleanup cron can DELETE WHERE
 * published_at < now() - interval '90 days'.
 */

export interface NewsArticleRow {
  id: string;
  finnhub_id: number | null;
  headline: string;
  summary: string | null;
  url: string;
  source: string;
  image_url: string | null;
  published_at: string;
  topic: string;
  tickers: string[];
  fetched_at: string;
}

/** Parse `fh-{id}` when Finnhub sent a numeric id. */
export function parseFinnhubId(id: string): number | null {
  if (!id.startsWith("fh-")) return null;
  const tail = id.slice(3);
  const n = Number(tail);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rowToFeedItem(row: NewsArticleRow): FeedItem {
  return {
    id: row.id,
    kind: "article",
    body: row.headline,
    url: row.url,
    source: row.source,
    handle: null,
    publishedAt: row.published_at,
    tickers: row.tickers ?? [],
    topic: row.topic as FeedItem["topic"],
    imageUrl: row.image_url,
    avatarUrl: null,
    sample: false,
    summary: row.summary,
  };
}

function feedItemToRow(item: FeedItem): NewsArticleRow | null {
  if (item.kind !== "article") return null;
  return {
    id: item.id,
    finnhub_id: parseFinnhubId(item.id),
    headline: item.body,
    summary: item.summary,
    url: item.url,
    source: item.source,
    image_url: item.imageUrl,
    published_at: item.publishedAt,
    topic: item.topic,
    tickers: item.tickers,
    fetched_at: new Date().toISOString(),
  };
}

/** Live items win on id collision — wire is fresher than the last upsert. */
export function mergeFeedItems(...lists: FeedItem[][]): FeedItem[] {
  const seen = new Map<string, FeedItem>();
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.id)) seen.set(item.id, item);
    }
  }
  return [...seen.values()].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

/**
 * Last row wins per id. The wire concatenates per-ticker Finnhub pages, so one
 * article can arrive several times; Postgres rejects the whole ON CONFLICT
 * batch ("cannot affect row a second time") if any id repeats.
 */
export function dedupeRowsById(rows: NewsArticleRow[]): NewsArticleRow[] {
  const byId = new Map<string, NewsArticleRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

export async function upsertArticles(items: FeedItem[]): Promise<void> {
  if (!hasDatabase) return;
  const rows = dedupeRowsById(
    items.map(feedItemToRow).filter((row): row is NewsArticleRow => row !== null),
  );
  if (rows.length === 0) return;

  const {error} = await db()
    .from("news_articles")
    .upsert(rows, {onConflict: "id", ignoreDuplicates: false});
  if (error) throw error;
}

export async function queryArticles({
  window,
  topic,
  limit = 500,
  now = Date.now(),
}: {
  window: NewsWindow;
  topic?: NewsTopic;
  limit?: number;
  now?: number;
}): Promise<FeedItem[]> {
  if (!hasDatabase) return [];

  const cutoff = new Date(now - NEWS_WINDOW_MS[window]).toISOString();
  let query = db()
    .from("news_articles")
    .select("*")
    .gte("published_at", cutoff)
    .order("published_at", {ascending: false})
    .limit(limit);

  if (topic === "posts") return [];
  if (topic === "rwa") query = query.eq("topic", "rwa");
  else if (topic === "robinhood") query = query.eq("topic", "robinhood");

  const {data, error} = await query;
  if (error) {
    console.warn("news archive query failed", error.message);
    return [];
  }
  return ((data ?? []) as NewsArticleRow[]).map(rowToFeedItem);
}

export async function getArticleById(id: string): Promise<FeedItem | null> {
  if (!hasDatabase) return null;
  const {data, error} = await db()
    .from("news_articles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("news archive lookup failed", error.message);
    return null;
  }
  if (!data) return null;
  return rowToFeedItem(data as NewsArticleRow);
}

/** Alias used by news.ts — DB lookup for /news/[id]. */
export const getArchivedArticle = getArticleById;
