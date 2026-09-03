/**
 * A small time-to-live cache, shared by every live source.
 *
 * Both upstream APIs are rate limited — Robinhood at 60 requests a second,
 * DexScreener at roughly 300 a minute — and a route handler runs per request.
 * Without this, a busy minute on the feed would exhaust either one.
 *
 * Stale-while-revalidate: an expired entry is still served, with the reload
 * started behind the response. Blocking on the reload meant whoever arrived
 * first after an expiry waited for the whole rebuild.
 *
 * In-process, so it resets on a cold start and is not shared between serverless
 * instances. That is deliberate: it is a throttle, not a database.
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
  const pending = inflight.get(key) as Promise<T> | undefined;

  // Fresh enough to serve outright.
  if (hit && hit.expires > Date.now()) return hit.value;

  /**
   * Expired, but we have the last answer.
   *
   * Serve it and refresh behind the request. Waiting for the reload was the
   * whole of the lag between pages: the market sweep takes several seconds to
   * rebuild, so whoever arrived first after an expiry paid for everyone. A
   * few seconds of staleness on a feed that refreshes every minute is not
   * worth a page that visibly stalls.
   */
  if (hit) {
    if (!pending) void refresh(key, ttlMs, load);
    return hit.value;
  }

  // Nothing to serve, so this caller does have to wait — but only one does.
  if (pending) return pending;
  return refresh(key, ttlMs, load);
}

/** Loads, stores, and clears its own in-flight marker. */
function refresh<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const promise = load()
    .then((value) => {
      store.set(key, {value, expires: Date.now() + ttlMs});
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  // A background refresh must not surface as an unhandled rejection; the
  // stored value simply stays until a later attempt succeeds.
  promise.catch(() => {});
  return promise;
}

/**
 * Drops a key, so the next caller recomputes rather than reading a bad answer.
 *
 * For results that came back empty because an upstream was unreachable: those
 * are indistinguishable from a real empty once stored, and a long TTL turns one
 * failed call into half an hour of wrong data.
 */
export function forget(key: string): void {
  store.delete(key);
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
