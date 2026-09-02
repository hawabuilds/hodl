/**
 * A small time-to-live cache, shared by every live source.
 *
 * Both upstream APIs are rate limited — Robinhood at 60 requests a second,
 * DexScreener at roughly 300 a minute — and a route handler runs per request.
 * Without this, a busy minute on the feed would exhaust either one.
 *
 * In-process, so it resets on a cold start and is not shared between serverless
 * instances. That is deliberate: it is a throttle, not a database. Part 03's
 * Postgres tables are what make the data durable; this is what keeps the app
 * responsive before those exist, and keeps it inside the limits afterwards.
 */
interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

/** Requests in flight, so ten simultaneous callers make one upstream call. */
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = load()
    .then((value) => {
      store.set(key, {value, expires: Date.now() + ttlMs});
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * The last good value for a key, whatever its age.
 *
 * Used when an upstream call fails: stale prices are worse than fresh ones but
 * far better than falling all the way back to seeded data, which would swap
 * every number on screen for a fictional one.
 */
export function stale<T>(key: string): T | null {
  const hit = store.get(key) as Entry<T> | undefined;
  return hit ? hit.value : null;
}

/** Fetch with a timeout, so one slow upstream cannot hang a page render. */
export async function getJson<T>(
  url: string,
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {accept: "application/json"},
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
