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
import {readShared, SHARED_CACHE, writeShared} from "./shared";
import {recordCacheHit, recordCacheMiss} from "./rpcMeter";

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
  if (hit && hit.expires > Date.now()) {
    recordCacheHit();
    return hit.value;
  }
  recordCacheMiss();

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

  // On a cold instance, ask the shared cache before doing the work. This is the
  // difference between a first visitor paying for two hundred quotes and a
  // pool sweep, and one paying for a single round trip to Redis.
  if (SHARED_CACHE) {
    return refreshVia(key, ttlMs, load);
  }

  return refresh(key, ttlMs, load);
}

/**
 * A short cache that never leaves this process.
 *
 * For data that is cheap to recompute, wanted very fresh, and asked for by
 * many callers at once — the head of the trade tape being the case this exists
 * for. `cached` would also write every answer to the shared cache, and at the
 * tape's cadence that is a Redis write per token every couple of seconds,
 * which is how a monthly command quota disappears in an afternoon.
 *
 * What it keeps from `cached` is the part that matters here: one in-flight
 * load per key, so a hundred simultaneous readers of the same token produce
 * one chain request between them rather than a hundred.
 */
export async function cachedLocal<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) {
    recordCacheHit();
    return hit.value;
  }

  const pending = inflight.get(key) as Promise<T> | undefined;
  // A shared in-flight load is a hit too: it is a caller who will not be
  // making a request of their own, which is the whole point of the dedup.
  if (pending) {
    recordCacheHit();
    return pending;
  }
  recordCacheMiss();

  const promise = load()
    .then((value) => {
      store.set(key, {value, expires: Date.now() + ttlMs});
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  promise.catch(() => {});
  return promise;
}

/**
 * Tries the shared cache first, then falls back to computing.
 *
 * Deliberately does not register in `inflight`: `refresh` owns that marker, and
 * having both manage it meant this one's cleanup deleted the other's, letting a
 * second caller start the expensive load that was already running. Concurrent
 * cold callers each make a Redis read, which is a round trip rather than a
 * rebuild, and they still share the one load underneath.
 */
async function refreshVia<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const shared = await readShared<T>(key);
  if (shared === null) return refresh(key, ttlMs, load);

  // Warm this instance from it, then refresh behind the caller so the shared
  // copy does not go stale for everyone at once.
  store.set(key, {value: shared, expires: Date.now() + ttlMs});
  void refresh(key, ttlMs, load).catch(() => {});
  return shared;
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
      // Written behind the caller, and kept a good deal longer than the local
      // copy: its job is to spare the *next* cold instance the rebuild, so it
      // needs to outlive the freshness window rather than match it.
      if (SHARED_CACHE) {
        void writeShared(key, value, Math.ceil((ttlMs * 10) / 1000));
      }
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
