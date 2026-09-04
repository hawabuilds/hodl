/**
 * A cache every instance can see, when one is configured.
 *
 * The TTL cache beside this lives inside one Node process. On a serverless
 * deployment that means every new instance starts cold and rebuilds everything
 * from scratch — the feed's first request pays several seconds for two hundred
 * quotes and a pool sweep, and it pays them again on the next cold start.
 *
 * Redis fixes the part the CDN cannot: work that is expensive to compute and
 * shared between readers. It is entirely optional. With no credentials
 * configured every call here is a no-op and the in-process cache carries on
 * exactly as before, which is what keeps local development free of a service
 * dependency.
 *
 * Reads never throw. A cache that is down has to degrade into a slower app, not
 * a broken one.
 */

/**
 * Upstash's REST credentials, injected by the Vercel Marketplace integration.
 *
 * The integration sets the `KV_REST_API_*` pair for compatibility with the
 * discontinued Vercel KV, and Upstash's own SDK reads `UPSTASH_REDIS_REST_*`.
 * Both spellings are accepted so it works whichever way the store was added.
 */
const URL_ =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? null;

const TOKEN =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? null;

export const SHARED_CACHE = Boolean(URL_ && TOKEN);

/** Requests are bounded: a slow cache must not outlast the thing it saves. */
const TIMEOUT_MS = 1_500;

/**
 * What a read may wait, as against a write.
 *
 * A second and a half was the same budget for both, and for the pair sweep —
 * three and a half megabytes of pool data — that was far too little to ever
 * finish. So every cold instance abandoned a cached copy it could have had and
 * rebuilt the sweep from DexScreener instead, which takes two to four minutes
 * and only partly succeeds inside a request. That is what made the feed answer
 * 451 tokens on one instance and 213 on the next.
 *
 * Waiting is the cheap side of this trade by three orders of magnitude: the
 * read either lands in a few seconds or it does not, and what it replaces is
 * minutes of upstream work. A write keeps the short budget, because the value
 * is already in hand and nobody is waiting on it.
 */
const READ_TIMEOUT_MS = 8_000;

/**
 * A Map survives the round trip; `JSON.stringify` alone does not.
 *
 * `JSON.stringify(new Map(...))` is `"{}"`. Two of the values held here are
 * Maps — every stock's quote, and on-chain supply — so the shared copy of both
 * was an empty object, and a cold instance that read one got something with no
 * `.get` on it. That surfaced two ways: stock quotes silently unavailable on
 * a cold instance, which is why tickers went missing from the feed and from
 * search, and a `TypeError: l.get is not a function` on the portfolio route
 * in production.
 *
 * Tagged rather than guessed at on the way back, so a plain object that
 * happens to have the same shape is still returned as a plain object.
 */
const MAP_TAG = "__map__";

/** Exported for tests; the cache itself uses these internally. */
export function encodeForShared(value: unknown): string {
  return JSON.stringify(value, (_key, held) =>
    held instanceof Map ? {[MAP_TAG]: [...held.entries()]} : held,
  );
}

export function decodeFromShared<T>(raw: string): T {
  return JSON.parse(raw, (_key, held) => {
    if (
      held &&
      typeof held === "object" &&
      Array.isArray((held as Record<string, unknown>)[MAP_TAG])
    ) {
      return new Map((held as Record<string, [unknown, unknown][]>)[MAP_TAG]);
    }
    return held;
  }) as T;
}

async function command<T>(
  body: unknown[],
  timeoutMs: number = TIMEOUT_MS,
): Promise<T | null> {
  if (!URL_ || !TOKEN) return null;

  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {result?: T};
    return json.result ?? null;
  } catch {
    // Timed out, unreachable, or misconfigured. The caller recomputes.
    return null;
  }
}

/** A previously stored value, or null if there is none or no cache at all. */
export async function readShared<T>(key: string): Promise<T | null> {
  const raw = await command<string>(["GET", key], READ_TIMEOUT_MS);
  if (raw === null) return null;
  try {
    return decodeFromShared<T>(raw);
  } catch {
    return null;
  }
}

/**
 * Stores a value under a time to live, in seconds.
 *
 * Deliberately not awaited by callers: the value is already in hand, and making
 * a reader wait on the write would spend the latency this exists to save.
 */
export async function writeShared(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  await command(["SET", key, encodeForShared(value), "EX", ttlSeconds]);
}

/**
 * Many keys in one round trip.
 *
 * For answers cached per item rather than per request. Keying a set of a
 * thousand tokens on the shape of the set meant one token appearing or leaving
 * invalidated the other nine hundred and ninety-nine, and the whole thing was
 * recomputed — which on a cold instance is most of the wait. Per-item keys
 * survive that, so long as reading a thousand of them is still one call.
 */
export async function readManyShared<T>(
  keys: string[],
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  if (!URL_ || !TOKEN || keys.length === 0) return found;

  try {
    const res = await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(keys.map((key) => ["GET", key])),
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });

    if (!res.ok) return found;
    const rows = (await res.json()) as {result?: string | null}[];

    rows.forEach((row, i) => {
      if (typeof row?.result !== "string") return;
      try {
        found.set(keys[i], decodeFromShared<T>(row.result));
      } catch {
        // A value we cannot parse is a value we do not have.
      }
    });
  } catch {
    // Unreachable or slow. Everything counts as a miss and gets computed.
  }

  return found;
}

/** Writes many keys in one round trip, each with its own time to live. */
export async function writeManyShared(
  entries: {key: string; value: unknown; ttlSeconds: number}[],
): Promise<void> {
  if (!URL_ || !TOKEN || entries.length === 0) return;

  try {
    await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        entries.map((entry) => [
          "SET",
          entry.key,
          encodeForShared(entry.value),
          "EX",
          entry.ttlSeconds,
        ]),
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
  } catch {
    // The values are already in hand; a failed write just costs the next
    // instance the work.
  }
}
