import {cached, stale} from "./cache";
import {linkPreviewUserAgent} from "@/config/appUrl";

/**
 * The picture a story actually leads with.
 *
 * The wire only sends an image field, and for most stories that field is the
 * outlet's house logo rather than the article's own photograph. The real one
 * is in the page's OpenGraph tags, so it has to be read from the article
 * itself.
 *
 * Coverage will never be total: some pages carry no tag, and some return a
 * consent or paywall interstitial instead of the article. A story with no
 * picture falls back to the drawn cover, which is what that artwork is for.
 */

/** A day. An article's lead image does not change after publication. */
const TTL_MS = 24 * 60 * 60_000;

/** Only the head is needed, and some article pages are megabytes. */
const MAX_BYTES = 180_000;

const TIMEOUT_MS = 6_000;

/** Pages in flight at once while a feed is being built. */
const CONCURRENCY = 8;

/**
 * How the fetch identifies itself.
 *
 * Names this app first, then carries the `facebookexternalhit` token, because
 * several publishers key their link-preview path on a recognised crawler and
 * serve everyone else something else entirely. Yahoo — most of this feed —
 * sends an unrecognised agent to a consent interstitial with no tags on it,
 * and serves the article with a real `og:image` to a crawler.
 *
 * This asks for the preview a publisher already publishes for the purpose, on
 * a public article, and identifies who is asking. It does not send consent
 * cookies or otherwise pretend a choice was made.
 */
const USER_AGENT = linkPreviewUserAgent();

const META_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url|:url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
];

function extract(html: string, base: string): string | null {
  for (const pattern of META_PATTERNS) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      // Tags carry relative paths often enough to matter, and they have to be
      // resolved against the page that was finally served, not the link that
      // was followed to get there.
      const url = new URL(match[1].trim(), base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

/** Reads at most `MAX_BYTES` of a response, then abandons the rest. */
async function head(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, MAX_BYTES);

  const decoder = new TextDecoder();
  let html = "";

  try {
    while (html.length < MAX_BYTES) {
      const {done, value} = await reader.read();
      if (done) break;
      html += decoder.decode(value, {stream: true});
      // The tags live in <head>; anything after it is the article body.
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return html;
}

async function load(url: string): Promise<string | null> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {"user-agent": USER_AGENT, accept: "text/html,*/*"},
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) return null;
  if (!(response.headers.get("content-type") ?? "").includes("html")) {
    return null;
  }

  // A consent or paywall interstitial answers 200 with a page that has no
  // article on it. Nothing to extract, and worth not mistaking for a story
  // that simply carries no picture.
  if (/(^|\.)consent\.|\/consent(\/|\?|$)/i.test(response.url)) return null;

  return extract(await head(response), response.url);
}

/** One article's image, cached including the misses. */
export async function ogImage(url: string): Promise<string | null> {
  const key = `og:${url}`;
  try {
    // Misses are cached too. Most of them are a consent wall or a page with no
    // tag, and neither becomes truthful by being asked again on every refresh.
    return await cached(key, TTL_MS, () => load(url));
  } catch {
    return stale<string | null>(key) ?? null;
  }
}

/**
 * Images for many articles, a few at a time.
 *
 * Bounded because a feed build should not open eighty sockets, and because the
 * whole batch sits behind one request that a reader is waiting on.
 */
export async function ogImages(
  urls: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const queue = [...new Set(urls)];
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const url = queue[index++];
      const image = await ogImage(url).catch(() => null);
      if (image) found.set(url, image);
    }
  }

  await Promise.all(
    Array.from({length: Math.min(CONCURRENCY, queue.length)}, worker),
  );

  return found;
}
