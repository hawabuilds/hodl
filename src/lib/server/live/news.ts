import {NEWS_WINDOW_MS} from "@/lib/newsWindow";
import type {FeedItem, NewsWindow, NewsTopic} from "@/lib/types";
import {cached, getJson, stale} from "./cache";
import {
  getArchivedArticle,
  mergeFeedItems,
  queryArticles,
  upsertArticles,
} from "./newsArchive";
import {RWA_REGISTRY} from "./robinhood";
import {posts} from "./x";
import {ogImages} from "./og";

/**
 * Finnhub, for the news tab.
 *
 * Two queries carry the whole feed: company news per ticker for the RWA side,
 * and company news for HOOD — Robinhood's own listing — for the Robinhood side.
 * That is a better Robinhood filter than a keyword search, because it is what
 * the wires already tag rather than a string match on headlines.
 *
 * The free tier is generous but not unlimited, so the whole feed is built once
 * and cached rather than queried per ticker per request.
 */

const BASE = "https://finnhub.io/api/v1";
/** Local freshness. Ten minutes plus Redis×10 used to pin a 100-minute snapshot. */
export const WIRE_TTL_MS = 2 * 60_000;
export const WIRE_SHARED_TTL_SECONDS = 180;
export const WIRE_MAX_STALE_MS = 3 * 60_000;
export const WIRE_CACHE_KEY = "fh:wire:v10";

/** Tickers to pull company news for. Cached two minutes, so 48 stays inside the free tier. */
const COVERED = 48;

interface FinnhubArticle {
  id?: number;
  category?: string;
  datetime?: number | string;
  headline?: string;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

/**
 * Finnhub's unix stamp. Company-news sends a number; the general wire
 * sometimes sends the same value as a string, and `Number.isFinite("…")`
 * is false — every market story then died in `toFeedItem`.
 */
export function finnhubDate(value: number | string | undefined): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function mapFinnhubToFeedItem(
  article: FinnhubArticle,
  topic: FeedItem["topic"],
  tickers: string[],
): FeedItem | null {
  const publishedAt = finnhubDate(article.datetime);
  if (!publishedAt || !article.headline || !article.url) return null;

  return {
    id: `fh-${article.id ?? article.url}`,
    kind: "article",
    body: article.headline,
    url: article.url,
    source: article.source ?? "Newswire",
    handle: null,
    publishedAt,
    tickers,
    topic,
    // Finnhub sends an empty string when a story has no artwork, which would
    // render as a broken image rather than fall back to the drawn cover.
    imageUrl: article.image?.trim() ? article.image : null,
    avatarUrl: null,
    sample: false,
    summary: article.summary?.trim() ? article.summary.trim() : null,
  };
}

function day(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Whether an article is actually about the company it came back under.
 *
 * Finnhub's per-symbol feed is loose — asking for NVDA returns general market
 * pieces alongside NVIDIA's own news. On a ticker's page that reads as broken,
 * so an article has to name the ticker or the company somewhere to survive.
 */
function isAbout(
  article: FinnhubArticle,
  symbol: string,
  companyName: string | null,
): boolean {
  const haystack = `${article.headline ?? ""} ${article.summary ?? ""}`;
  // String.raw so the word boundaries survive: inside an ordinary template
  // literal a lone backslash-b is a backspace character, and this silently
  // matched nothing.
  if (new RegExp(String.raw`\b${symbol}\b`, "i").test(haystack)) return true;
  // Deliberately not trusting `related`: on a company-news query Finnhub sets
  // it to the symbol asked for, so it is true of every article and passed the
  // whole unfiltered feed through.

  return mentionsCompanyName(haystack, companyName);
}

function mentionsCompanyName(
  haystack: string,
  companyName: string | null,
): boolean {
  if (!companyName) return false;
  // "Advanced Micro Devices" also matches on "Advanced Micro".
  const head = companyName.split(/[ ,]/).slice(0, 2).join(" ");
  return head.length >= 4 && haystack.toLowerCase().includes(head.toLowerCase());
}

/**
 * Tickers that are also English words. `\bNOW\b` would otherwise tag every
 * story that says "now".
 */
const COMMON_TICKERS = new Set([
  "AI",
  "ALL",
  "APP",
  "BE",
  "CAN",
  "FIG",
  "FIX",
  "FLY",
  "FOR",
  "GE",
  "HAS",
  "IT",
  "NET",
  "NEW",
  "NOW",
  "NU",
  "ON",
  "OR",
  "OUT",
  "PL",
  "PR",
  "RUN",
  "SO",
  "TE",
]);

function mentionedCovered(article: FinnhubArticle): string[] {
  const hay = `${article.headline ?? ""} ${article.summary ?? ""}`;
  const found: string[] = [];
  for (const entry of RWA_REGISTRY) {
    const tickerSafe =
      entry.ticker.length >= 3 && !COMMON_TICKERS.has(entry.ticker);
    const tickerHit =
      tickerSafe &&
      new RegExp(String.raw`\b${entry.ticker}\b`, "i").test(hay);
    if (tickerHit || mentionsCompanyName(hay, entry.name)) {
      found.push(entry.ticker);
      if (found.length >= 6) break;
    }
  }
  return found;
}

/**
 * Indexes, rates, commodities — the reasons a general wire story belongs on
 * a stocks app even when it does not name a covered ticker.
 */
const MARKET_TERMS = new RegExp(
  String.raw`\b(?:s&p 500|s&p|spx|nasdaq|dow jones|dow|russell|wall street|stock market|bull market|bear market|big tech|fomc|federal reserve|fed|ecb|cpi|inflation|interest rate|rate hike|rate cut|central bank|treasuries|treasury yield|treasury bond|bond yield|bonds|yields|oil|crude|brent|wti|opec|hormuz|energy|natural gas|gasoline|gas|gold|silver|futures|etfs?|earnings|ipo|stocks?|shares|equities|equity|indexes|indices|index fund|merger|takeover|buyout|commodit(?:y|ies)|forex|bitcoin|crypto|dollar|yen|rupee|rand|trading|markets?|economy|economic|gdp|recession)\b`,
  "i",
);

/**
 * Outlets whose general-wire copy is market tape even when the headline
 * skips "stocks". Still not RWA unless a covered name is in the piece.
 */
const FINANCIAL_OUTLETS =
  /\b(reuters|bloomberg|cnbc|marketwatch|wsj|wall street journal|financial times|\bft\b|barron'?s|yahoo|investing\.com|thestreet|benzinga|zacks|seeking alpha|dow ?jones|associated press)\b/i;

/**
 * Geopolitics and elections that must stay off Top stories even from Reuters.
 * Checked only after market terms, so "oil after Houthi attacks" still lands
 * in Markets.
 */
const PURE_POLITICS =
  /\b(sanctions|houthis?|yemen|midterm|convention|funeral|election|campaign|senate race|white house|geopolitics|ceasefire|gaza|ukraine|iran(?:-related)?)\b/i;

/**
 * Where a general-wire article belongs, if it belongs at all.
 *
 * Company-news is already ticker-scoped. Finnhub `category=general` is not:
 * geopolitics, elections and crime sit next to the S&P tape. Only stories that
 * name a covered stock, Robinhood, or an obvious market term survive — and
 * market-moving geopolitics stay out of the RWA stocks filter.
 */
export function classifyWireCopy(
  headline: string,
  summary = "",
  related = "",
  source = "",
): {topic: FeedItem["topic"]; tickers: string[]} | null {
  const hay = `${headline} ${summary} ${related}`;
  if (/\b(robinhood|hood)\b/i.test(hay)) {
    return {topic: "robinhood", tickers: []};
  }
  const tickers = mentionedCovered({headline, summary});
  if (tickers.length > 0) return {topic: "rwa", tickers};
  if (MARKET_TERMS.test(hay)) return {topic: "market", tickers: []};
  if (FINANCIAL_OUTLETS.test(source) && !PURE_POLITICS.test(hay)) {
    return {topic: "market", tickers: []};
  }
  return null;
}

async function companyNews(
  symbol: string,
  topic: FeedItem["topic"],
  tickers: string[],
  companyName: string | null = null,
): Promise<FeedItem[]> {
  const params = new URLSearchParams({
    symbol,
    from: day(30),
    to: day(-1),
    token: process.env.NEWS_API_KEY ?? "",
  });

  const body = await getJson<FinnhubArticle[]>(
    `${BASE}/company-news?${params}`,
    9000,
  );

  return (Array.isArray(body) ? body : [])
    .filter((article) => isAbout(article, symbol, companyName))
    .map((article) => mapFinnhubToFeedItem(article, topic, tickers))
    .filter((item): item is FeedItem => item !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/**
 * Stories that share one image are showing an outlet logo, not a photograph.
 *
 * The wire sends a house placeholder whenever a story has no artwork of its
 * own — Yahoo's accounts for two-thirds of a typical batch — and forty-eight
 * identical logos down a news feed reads worse than no pictures at all. Any
 * image used by more than a couple of stories is treated as branding and
 * dropped, which sends those cards to the drawn cover instead.
 *
 * Frequency rather than a list of known URLs: outlets change their
 * placeholders, and a hard-coded list silently stops working when they do.
 */
const SHARED_IMAGE_LIMIT = 2;

/**
 * How many articles get their page fetched for a real lead image.
 *
 * Covers the whole feed rather than the first page of it: a reader scrolling
 * past forty stories was hitting a wall of drawn covers. The cap only bites on
 * the first build after a cold start — the day-long cache makes every later
 * refresh free — and the fetches run eight at a time behind one request.
 */
const OG_LOOKUPS = 90;

/**
 * Market-wide wire copy, not tied to one ticker.
 *
 * Company-news is Yahoo-heavy because that is who syndicates most per-symbol
 * stories. The general category is where Reuters, Bloomberg, MarketWatch and
 * CNBC actually show up, so the tab is not one outlet all the way down — but
 * Finnhub does not ticker-filter it, so geopolitics has to be classified
 * (or dropped) rather than stamped RWA.
 */
async function marketNews(): Promise<FeedItem[]> {
  const params = new URLSearchParams({
    category: "general",
    token: process.env.NEWS_API_KEY ?? "",
  });

  const body = await getJson<FinnhubArticle[]>(
    `${BASE}/news?${params}`,
    9000,
  );

  return (Array.isArray(body) ? body : [])
    .flatMap((article) => {
      const classified = classifyWireCopy(
        article.headline ?? "",
        article.summary ?? "",
        article.related ?? "",
        article.source ?? "",
      );
      if (!classified) return [];
      const item = mapFinnhubToFeedItem(
        article,
        classified.topic,
        classified.tickers,
      );
      return item ? [item] : [];
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 60);
}

function stripOutletLogos(items: FeedItem[]): FeedItem[] {
  const uses = new Map<string, number>();
  for (const item of items) {
    if (item.imageUrl) uses.set(item.imageUrl, (uses.get(item.imageUrl) ?? 0) + 1);
  }

  return items.map((item) =>
    item.imageUrl && (uses.get(item.imageUrl) ?? 0) > SHARED_IMAGE_LIMIT
      ? {...item, imageUrl: null}
      : item,
  );
}

/**
 * HOOD and the general wire first, then per-ticker pages.
 *
 * Firing every Finnhub call at once is how a single 429 emptied the whole
 * feed: each failure becomes `[]`, and an empty build used to be written to
 * Redis for an hour. Two cheap queries still fill the tab if the ticker
 * burst is rate-limited.
 */
function logWireMiss(label: string, error: unknown): FeedItem[] {
  const raw = error instanceof Error ? error.message : String(error);
  const status = /\s->\s(\d+)$/.exec(raw)?.[1];
  console.warn(`news wire ${label} failed${status ? ` HTTP ${status}` : ""}`);
  return [];
}

async function wireNews(): Promise<FeedItem[][]> {
  const head = await Promise.all([
    // Company name so "Robinhood" headlines survive isAbout; the ticker
    // alone drops every story that never writes HOOD.
    companyNews("HOOD", "robinhood", [], "Robinhood").catch((error) =>
      logWireMiss("HOOD", error),
    ),
    marketNews().catch((error) => logWireMiss("market", error)),
    // Index tape so Today still has Markets stories when the general wire
    // is politics-heavy or the datetime field comes back unusable.
    companyNews("SPY", "market", [], "S&P 500")
      .then((items) => items.slice(0, 16))
      .catch((error) => logWireMiss("SPY", error)),
  ]);
  const rest = await Promise.all(
    RWA_REGISTRY.slice(0, COVERED).map((entry) =>
      companyNews(entry.ticker, "rwa", [entry.ticker], entry.name)
        .then((items) => items.slice(0, 8))
        .catch((error) => logWireMiss(entry.ticker, error)),
    ),
  );
  return [...head, ...rest];
}

/** Finnhub articles only. X posts live in their own cache — do not mix. */
async function buildWire(): Promise<FeedItem[]> {
  if (!process.env.NEWS_API_KEY) {
    console.warn("news wire skipped: NEWS_API_KEY unset");
    return [];
  }

  const items = stripOutletLogos((await wireNews()).flat()).sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  if (items.length === 0) {
    console.warn("news wire returned 0 articles");
    return [];
  }

  const wanted = items.slice(0, OG_LOOKUPS).map((item) => item.url);
  const images = await ogImages(wanted);
  const enriched =
    images.size === 0
      ? items
      : items.map((item) =>
          images.has(item.url)
            ? {...item, imageUrl: images.get(item.url)!}
            : item,
        );
  try {
    await upsertArticles(enriched);
  } catch (error) {
    console.warn(
      "news archive upsert failed",
      error instanceof Error ? error.message : error,
    );
  }
  return enriched;
}

export function hasArticles(items: FeedItem[]): boolean {
  return items.some((item) => item.kind === "article");
}

/** Age of the newest stamp, or Infinity when nothing parses. */
export function newestAgeMs(
  items: {publishedAt: string}[],
  now: number = Date.now(),
): number {
  let newest = -Infinity;
  for (const item of items) {
    const at = Date.parse(item.publishedAt);
    if (Number.isFinite(at) && at > newest) newest = at;
  }
  return newest === -Infinity ? Infinity : now - newest;
}

async function loadWire(): Promise<FeedItem[]> {
  const key = WIRE_CACHE_KEY;
  let wire: FeedItem[] = [];
  try {
    wire = await cached(key, WIRE_TTL_MS, buildWire, {
      cacheEmpty: false,
      sharedTtlSeconds: WIRE_SHARED_TTL_SECONDS,
      maxStaleMs: WIRE_MAX_STALE_MS,
    });
  } catch {
    wire = stale<FeedItem[]>(key) ?? [];
  }
  if (wire.length === 0) wire = stale<FeedItem[]>(key) ?? [];
  return wire;
}

/**
 * The wire this instance already holds, at any age, without fetching.
 *
 * Distinct from `loadWire`, which will happily block for a full rebuild. This
 * is only ever the "do we already have one" question.
 */
function wireOnHand(): FeedItem[] {
  return stale<FeedItem[]>(WIRE_CACHE_KEY) ?? [];
}

/**
 * Whether a response can go out now, leaving the wire to rebuild behind it.
 *
 * Either source alone is a feed worth serving. Only when both are empty —
 * a cold instance with no archive to read — does a caller have to wait.
 */
export function canServeWithoutWire(
  archived: FeedItem[],
  onHand: FeedItem[],
): boolean {
  return hasArticles(archived) || hasArticles(onHand);
}

async function buildFeed(
  window: NewsWindow = "all",
  topic: NewsTopic = "all",
): Promise<FeedItem[]> {
  // The posts tab reads none of the wire, so it should never wait on one.
  if (topic === "posts") return posts().catch(() => [] as FeedItem[]);

  const [accountPosts, archived] = await Promise.all([
    posts().catch(() => [] as FeedItem[]),
    queryArticles({window, topic}).catch(() => [] as FeedItem[]),
  ]);

  /**
   * Rebuild behind the request whenever we have something to answer with.
   *
   * A cold wire is roughly fifty Finnhub pages plus up to ninety publisher
   * fetches for artwork, and `cached` only absorbs that for three minutes past
   * an expiry — so on a quiet app most arrivals were the unlucky one paying
   * for it in full. The archive is a single indexed read of the same articles,
   * including their images, which is precisely what it was added for. Serve
   * that, refresh the wire behind, and let the next request have the newer
   * copy. `cached` dedupes the in-flight rebuild, so this cannot stampede.
   */
  const onHand = wireOnHand();
  if (canServeWithoutWire(archived, onHand)) {
    void loadWire().catch(() => {
      // Background refresh; the served response does not depend on it.
    });
    return mergeFeedItems(onHand, accountPosts, archived);
  }

  // Nothing cached and nothing archived — this caller does have to wait.
  const wire = await loadWire();
  return mergeFeedItems(wire, accountPosts, archived);
}

export async function feed(
  window: NewsWindow,
  topic: NewsTopic,
  now: number = Date.now(),
): Promise<FeedItem[]> {
  // Wire and X posts are cached separately. A combined key used to persist
  // an X-only list after Finnhub 429'd, which hid every article for an hour.
  const all = await buildFeed(window, topic);

  const cutoff = now - NEWS_WINDOW_MS[window];

  return all.filter((item) => {
    if (Date.parse(item.publishedAt) < cutoff) return false;
    if (topic === "posts") return item.kind === "account";
    if (topic === "rwa") return item.topic === "rwa";
    if (topic === "robinhood") return item.topic === "robinhood";
    return true;
  });
}

/** Headlines for one ticker, for the RWA chart page's News tab. */
/** One cached wire article, for the in-app reader. */
export async function articleById(id: string): Promise<FeedItem | null> {
  const archived = await getArchivedArticle(id);
  if (archived) return archived;
  const all = await buildFeed();
  const item = all.find((entry) => entry.id === id);
  if (!item || item.kind !== "article") return null;
  return item;
}

export async function newsForTicker(ticker: string): Promise<FeedItem[]> {
  if (!process.env.NEWS_API_KEY) {
    throw new Error("News provider is not configured.");
  }
  const key = `fh:ticker:${ticker}`;
  const name = RWA_REGISTRY.find((entry) => entry.ticker === ticker)?.name ?? null;
  try {
    const loaded = await cached(
      key,
      WIRE_TTL_MS,
      () => companyNews(ticker, "rwa", [ticker], name).then((items) => items.slice(0, 8)),
      {
        cacheEmpty: false,
        sharedTtlSeconds: WIRE_SHARED_TTL_SECONDS,
        maxStaleMs: WIRE_MAX_STALE_MS,
      },
    );
    if (loaded.length > 0) return loaded;
  } catch (error) {
    const previous = stale<FeedItem[]>(key);
    if (previous && previous.length > 0) return previous;
    throw error instanceof Error ? error : new Error("Could not load news.");
  }
  return stale<FeedItem[]>(key) ?? [];
}
