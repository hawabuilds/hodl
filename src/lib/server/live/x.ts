import type {FeedItem} from "@/lib/types";
import {cached, stale} from "./cache";

/**
 * Real posts from the Robinhood accounts, for the news feed.
 *
 * These are the accounts the feed already named; until now they carried a
 * standing description of what each one posts about, because attaching invented
 * words to a real person's verified name would be a fabricated record. This
 * replaces those with what the accounts actually said.
 *
 * The whole set is fetched in a single search — `from:a OR from:b` — rather
 * than one request per account. X's free tier counts requests, not results, and
 * three separate calls exhausted the window three times as fast for the same
 * data.
 */

const BASE = "https://api.x.com/2";

/**
 * Fifteen minutes.
 *
 * Matched to X's rate-limit window rather than to how fast these accounts post.
 * Overrunning it returns 429s for the rest of the window, which would cost the
 * feed its posts entirely.
 */
const TTL_MS = 15 * 60_000;

/** The accounts the Robinhood side of the feed follows. */
const HANDLES = [
  {handle: "RobinhoodApp", name: "Robinhood"},
  {handle: "vladtenev", name: "Vlad Tenev"},
] as const;

/**
 * No calls to X before this time. X bills reads from prepaid credits; once
 * they run out every call is a 402, and retrying on each page view would only
 * fill the logs. One warning per window says so — to the logs, never a user.
 */
let pausedUntil = 0;

/** A 402 from X: the account's prepaid credits are used up. */
export function creditsDepleted(status: number, body: {type?: string} | null): boolean {
  return status === 402 || /credits-depleted/.test(body?.type ?? "");
}

const BY_ID = new Map<string, (typeof HANDLES)[number]>();

interface SearchResponse {
  data?: {
    id: string;
    text: string;
    created_at?: string;
    author_id?: string;
  }[];
  includes?: {
    users?: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    }[];
  };
  errors?: unknown[];
}

/**
 * Strips the trailing t.co link X appends for a post's own media or quote.
 *
 * It is not part of what was written and renders as noise on a card that
 * already links to the post.
 */
function clean(text: string): string {
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, "").trim();
}

async function load(): Promise<FeedItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  if (Date.now() < pausedUntil) return [];

  // Replies and retweets are excluded at the query rather than filtered after:
  // these accounts reply constantly, and a news feed of "@someone 🙏" is noise
  // that would also eat the thirty results a request returns.
  const from = HANDLES.map((entry) => `from:${entry.handle}`).join(" OR ");
  const query = `(${from}) -is:reply -is:retweet`;
  const params = new URLSearchParams({
    query,
    max_results: "30",
    "tweet.fields": "created_at,author_id",
    expansions: "author_id",
    "user.fields": "profile_image_url",
  });

  const res = await fetch(`${BASE}/tweets/search/recent?${params}`, {
    headers: {authorization: `Bearer ${token}`},
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });

  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as {type?: string} | null;
    if (creditsDepleted(res.status, problem)) {
      pausedUntil = Date.now() + TTL_MS;
      console.warn(
        "[x] X API credits are used up: Robinhood posts are hidden until credits are added at console.x.com.",
      );
      return [];
    }
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-rate-limit-reset")) * 1000;
      pausedUntil = Number.isFinite(reset) && reset > Date.now() ? reset : Date.now() + TTL_MS;
    }
    throw new Error(`x search -> ${res.status}`);
  }
  const body = (await res.json()) as SearchResponse;

  // The search returns author ids; the usernames come back in `includes`.
  const users = new Map(
    (body.includes?.users ?? []).map((user) => [user.id, user]),
  );

  const items: FeedItem[] = [];

  for (const post of body.data ?? []) {
    const user = post.author_id ? users.get(post.author_id) : undefined;
    const known = HANDLES.find(
      (entry) =>
        entry.handle.toLowerCase() === (user?.username ?? "").toLowerCase(),
    );
    // Only the accounts asked for. A search can widen unexpectedly, and a post
    // attributed to the wrong name is worse than no post at all.
    if (!known) continue;
    if (post.author_id) BY_ID.set(post.author_id, known);

    const text = clean(post.text);
    if (!text) continue;

    items.push({
      id: `x-${post.id}`,
      kind: "account",
      body: text,
      url: `https://x.com/${known.handle}/status/${post.id}`,
      source: known.name,
      handle: known.handle,
      publishedAt: post.created_at ?? new Date().toISOString(),
      tickers: [],
      topic: "robinhood",
      imageUrl: null,
      // X serves a 48px "_normal" crop by default, which is soft on a retina
      // avatar. The original is the same URL without that suffix.
      avatarUrl:
        user?.profile_image_url?.replace("_normal", "_400x400") ?? null,
      sample: false,
      summary: null,
    });
  }

  return items.sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

/**
 * Recent posts, or nothing.
 *
 * Returning nothing is deliberate on failure: the cards these fill sit under
 * real names, so an empty Posts tab is the correct outcome when the real posts
 * cannot be reached.
 */
export async function posts(): Promise<FeedItem[]> {
  const key = "x:posts:v2";
  try {
    const loaded = await cached(key, TTL_MS, load);
    if (loaded.length > 0) return loaded;
  } catch (error) {
    console.error("x posts failed", error);
  }
  return stale<FeedItem[]>(key) ?? [];
}
