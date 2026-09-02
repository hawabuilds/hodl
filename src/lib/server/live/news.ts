import type {FeedItem, NewsWindow, NewsTopic} from "@/lib/types";
import {cached, getJson, stale} from "./cache";
import {RWA_REGISTRY} from "./robinhood";

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

/** Tickers to pull company news for. More than this exhausts the tier. */
const COVERED = 24;

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
 * The Robinhood accounts, carried through from the seeded feed.
 *
 * They stay text-free on purpose: these are real accounts belonging to real
 * people, and putting invented words beside a verified name would be a
 * fabricated record. The X API replaces the standing line with real posts; the
 * card is the same either way.
 */
const ACCOUNTS: FeedItem[] = [
  {
    id: "account-RobinhoodApp",
    kind: "account",
    body: "Product and listing announcements post here first.",
    url: "https://x.com/RobinhoodApp",
    source: "Robinhood",
    handle: "RobinhoodApp",
    publishedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    tickers: [],
    topic: "robinhood",
    sample: true,
  },
  {
    id: "account-RobinhoodCrypto",
    kind: "account",
    body: "Chain, token and custody updates.",
    url: "https://x.com/RobinhoodCrypto",
    source: "Robinhood Crypto",
    handle: "RobinhoodCrypto",
    publishedAt: new Date(Date.now() - 80 * 60_000).toISOString(),
    tickers: [],
    topic: "robinhood",
    sample: true,
  },
  {
    id: "account-vladtenev",
    kind: "account",
    body: "Co-founder and CEO. Long-form threads on tokenization.",
    url: "https://x.com/vladtenev",
    source: "Vlad Tenev",
    handle: "vladtenev",
    publishedAt: new Date(Date.now() - 120 * 60_000).toISOString(),
    tickers: [],
    topic: "robinhood",
    sample: true,
  },
];

async function buildFeed(): Promise<FeedItem[]> {
  if (!process.env.NEWS_API_KEY) return [];

  // Coverage is finite, so spend it on the names people actually open.
  const batches = await Promise.all([
    companyNews("HOOD", "robinhood", []).catch(() => []),
    ...RWA_REGISTRY.slice(0, COVERED).map((entry) =>
      companyNews(entry.ticker, "rwa", [entry.ticker], entry.name)
        .then((items) => items.slice(0, 4))
        .catch(() => []),
    ),
  ]);

  const seen = new Map<string, FeedItem>();
  for (const item of batches.flat()) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }

  return [...seen.values(), ...ACCOUNTS].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
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
