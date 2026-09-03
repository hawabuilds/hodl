import type {FeedItem, NewsWindow, NewsTopic} from "@/lib/types";
import {cached, getJson, stale} from "./cache";
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
const TTL_MS = 10 * 60_000;

/** Tickers to pull company news for. Cached ten minutes, so 48 stays inside the free tier. */
const COVERED = 48;

interface FinnhubArticle {
  id?: number;
  category?: string;
  datetime?: number;
  headline?: string;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

function iso(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toFeedItem(
  article: FinnhubArticle,
  topic: "rwa" | "robinhood",
  tickers: string[],
): FeedItem | null {
  const publishedAt = iso(article.datetime);
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

  if (companyName) {
    // "Advanced Micro Devices" also matches on "Advanced Micro".
    const head = companyName.split(/[ ,]/).slice(0, 2).join(" ");
    if (head.length >= 4 && haystack.toLowerCase().includes(head.toLowerCase())) {
      return true;
    }
  }
  return false;
}

async function companyNews(
  symbol: string,
  topic: "rwa" | "robinhood",
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
    .map((article) => toFeedItem(article, topic, tickers))
    .filter((item): item is FeedItem => item !== null);
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
 * CNBC actually show up, so the tab is not one outlet all the way down.
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
    .slice(0, 40)
    .map((article) => {
      const hay = `${article.headline ?? ""} ${article.summary ?? ""} ${article.related ?? ""}`;
      const topic: "rwa" | "robinhood" = /\b(robinhood|hood)\b/i.test(hay)
        ? "robinhood"
        : "rwa";
      const related = (article.related ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 6);
      return toFeedItem(article, topic, related);
    })
    .filter((item): item is FeedItem => item !== null);
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

async function buildFeed(): Promise<FeedItem[]> {
  // Coverage is finite, so spend it on the names people actually open.
  const [wire, accountPosts] = await Promise.all([
    process.env.NEWS_API_KEY
      ? Promise.all([
          companyNews("HOOD", "robinhood", []).catch(() => []),
          marketNews().catch(() => []),
          ...RWA_REGISTRY.slice(0, COVERED).map((entry) =>
            companyNews(entry.ticker, "rwa", [entry.ticker], entry.name)
              .then((items) => items.slice(0, 4))
              .catch(() => []),
          ),
        ])
      : Promise.resolve([] as FeedItem[][]),
    // Cached on its own fifteen-minute window, so a headline refresh does not
    // spend an X request it does not need.
    posts().catch(() => [] as FeedItem[]),
  ]);

  const seen = new Map<string, FeedItem>();
  for (const item of [...wire.flat(), ...accountPosts]) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }

  const items = stripOutletLogos([...seen.values()]).sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );

  // The article's own lead image, read from its OpenGraph tags. Only for the
  // newest stories: the rest are far down a feed nobody scrolls to, and each
  // one costs a page fetch. Cached for a day, so a refresh pays nothing.
  const wanted = items
    .filter((item) => item.kind === "article")
    .slice(0, OG_LOOKUPS)
    .map((item) => item.url);

  const images = await ogImages(wanted);
  if (images.size === 0) return items;

  return items.map((item) =>
    images.has(item.url) ? {...item, imageUrl: images.get(item.url)!} : item,
  );
}

const WINDOW_MS: Record<NewsWindow, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

export async function feed(
  window: NewsWindow,
  topic: NewsTopic,
  now: number = Date.now(),
): Promise<FeedItem[]> {
  const key = "fh:feed";
  let all: FeedItem[] = [];

  try {
    all = await cached(key, TTL_MS, buildFeed);
  } catch {
    all = stale<FeedItem[]>(key) ?? [];
  }
  if (all.length === 0) all = stale<FeedItem[]>(key) ?? [];

  const cutoff = now - WINDOW_MS[window];

  return all.filter((item) => {
    if (Date.parse(item.publishedAt) < cutoff) return false;
    if (topic === "posts") return item.kind === "account";
    if (topic === "rwa") return item.topic === "rwa";
    if (topic === "robinhood") return item.topic === "robinhood";
    return true;
  });
}

/** Headlines for one ticker, for the RWA chart page's News tab. */
export async function newsForTicker(ticker: string): Promise<FeedItem[]> {
  const key = `fh:ticker:${ticker}`;
  const name = RWA_REGISTRY.find((entry) => entry.ticker === ticker)?.name ?? null;
  try {
    const loaded = await cached(key, TTL_MS, () =>
      companyNews(ticker, "rwa", [ticker], name).then((items) => items.slice(0, 8)),
    );
    if (loaded.length > 0) return loaded;
  } catch {
    // fall through
  }
  return stale<FeedItem[]>(key) ?? [];
}
