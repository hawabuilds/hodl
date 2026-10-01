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
import {waitUntil} from "@vercel/functions";
import {claimShared, readManyShared, readShared, SHARED_CACHE, writeShared} from "./shared";
import {recordCacheHit, recordCacheMiss} from "./rpcMeter";

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Lets work outlive the response that started it. On Vercel a function is
 * frozen once it has answered, so a rebuild started behind a served copy —
 * every page build slower than PAGE_PATIENCE_MS, every stale-while-refresh —
 * was cut off and never finished: the page's saved copy simply aged. Outside
 * Vercel this does nothing, and the work runs on as before.
 */
function keepAlive(work: Promise<unknown>): void {
  try {
    waitUntil(work.catch(() => {}));
  } catch {
    // No request context (a script, a test): nothing to keep alive.
  }
}

/** Requests in flight, so ten simultaneous callers make one upstream call. */
const inflight = new Map<string, Promise<unknown>>();

export type CacheOptions = {
  /**
   * When false, an empty array is a miss: it is not written to Redis, a shared
   * `[]` is rebuilt, and the in-process store is not warmed with nothing.
   * For feeds where empty usually means the upstream failed, not "no news".
   */
  cacheEmpty?: boolean;
  /**
   * Redis TTL in seconds. Default is 10× the local TTL so a cold instance can
   * reuse a market sweep. News must pass a much shorter value — 10× of a
   * ten-minute wire TTL is 100 minutes of last night's tape.
   */
  sharedTtlSeconds?: number;
  /**
   * How long past expiry a value may still be served while a refresh runs.
   * After this the caller waits for a rebuild. Without a cap, a failed
   * refresh leaves the expired snapshot in place indefinitely.
   */
  maxStaleMs?: number;
};

/**
 * Whether a cached value is something we should serve or persist.
 *
 * `null` is always a miss. An empty array is a miss only when the caller
 * opted out of caching empties — otherwise `[]` is a real answer (no trades,
 * no pairs) and must stay a hit.
 */
export function isUsableCachedValue<T>(
  value: T | null,
  cacheEmpty = true,
): value is T {
  if (value === null) return false;
  if (!cacheEmpty && Array.isArray(value) && value.length === 0) return false;
  return true;
}

function allowsEmpty(options?: CacheOptions): boolean {
  return options?.cacheEmpty !== false;
}

function sharedTtlSeconds(ttlMs: number, options?: CacheOptions): number {
  return options?.sharedTtlSeconds ?? Math.ceil((ttlMs * 10) / 1000);
}

/** True when the entry has been expired longer than the caller will tolerate. */
export function isPastMaxStale(
  expires: number,
  maxStaleMs: number,
  now: number = Date.now(),
): boolean {
  return now - expires > maxStaleMs;
}

function tooStale(hit: Entry<unknown>, options?: CacheOptions): boolean {
  if (options?.maxStaleMs == null) return false;
  return isPastMaxStale(hit.expires, options.maxStaleMs);
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options?: CacheOptions,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  const pending = inflight.get(key) as Promise<T> | undefined;

  // Fresh enough to serve outright.
  if (
    hit &&
    hit.expires > Date.now() &&
    isUsableCachedValue(hit.value, allowsEmpty(options))
  ) {
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
  if (
    hit &&
    isUsableCachedValue(hit.value, allowsEmpty(options)) &&
    !tooStale(hit, options)
  ) {
    if (!pending) void refresh(key, ttlMs, load, options);
    return hit.value;
  }

  // Nothing to serve, so this caller does have to wait — but only one does.
  if (pending) return pending;

  // On a cold instance, ask the shared cache before doing the work. This is the
  // difference between a first visitor paying for two hundred quotes and a
  // pool sweep, and one paying for a single round trip to Redis.
  if (SHARED_CACHE) {
    return refreshVia(key, ttlMs, load, options);
  }

  return refresh(key, ttlMs, load, options);
}

/** How long a page's last good copy is kept: long enough to outlast any quiet spell. */
const LAST_GOOD_SECONDS = 24 * 60 * 60;
/** A page's last good copy is rewritten at most this often, to spare Redis commands. */
const LAST_GOOD_EVERY_MS = 60_000;
/** How long a reader waits on a fresh answer before being given the last good copy. */
const PAGE_PATIENCE_MS = 1_500;
/**
 * A page is rebuilt at most once in this window across every server: whoever
 * claims it builds, the rest read that build's shared copy. Without this each
 * serverless instance rebuilt every page on its own every few seconds, which
 * is what kept the database's CPU pinned.
 */
const PAGE_REBUILD_MS = 60_000;

const lastGoodLocal = new Map<string, unknown>();
const lastGoodWrittenAt = new Map<string, number>();

/**
 * `cached`, for whole pages that must never answer with an error.
 *
 * On a fresh server (after a deploy, or a quiet spell longer than the shared
 * copy lives) `cached` has nothing to serve and the first reader waits on the
 * whole build — and gets an error if it fails. Here every good build is also
 * kept as a *last good copy* for a day, and a reader who would wait longer
 * than PAGE_PATIENCE_MS, or whose build failed, gets that copy instead,
 * however old, while the build carries on behind them. Only a page that has
 * never once been built can still fail.
 */
export async function cachedPage<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options?: CacheOptions & {
    /** For a page never built yet: something to show meanwhile (null = nothing). */
    standIn?: () => Promise<T | null>;
  },
): Promise<T> {
  const lastGoodKey = `last-good:${key}`;
  const build = cached(
    key,
    ttlMs,
    async () => {
      if (SHARED_CACHE && !(await claimShared(`rebuild:${key}`, Math.max(ttlMs, PAGE_REBUILD_MS)))) {
        // Another server is building (or built) this page in this window.
        const theirs =
          (await readShared<T>(key)) ??
          (lastGoodLocal.get(key) as T | undefined) ??
          (await readShared<T>(lastGoodKey));
        if (theirs != null && isUsableCachedValue(theirs, allowsEmpty(options))) return theirs;
      }
      const value = await load();
      if (isUsableCachedValue(value, allowsEmpty(options))) {
        lastGoodLocal.set(key, value);
        const now = Date.now();
        if (SHARED_CACHE && now - (lastGoodWrittenAt.get(key) ?? 0) >= LAST_GOOD_EVERY_MS) {
          lastGoodWrittenAt.set(key, now);
          keepAlive(writeShared(lastGoodKey, value, LAST_GOOD_SECONDS));
          keepAlive(writeShared(`built-at:${key}`, now, LAST_GOOD_SECONDS));
        }
      }
      return value;
    },
    options,
  );
  build.catch(() => {});

  // A cached answer, or a quick build, is used as it is.
  const quick = await Promise.race([
    build.then(
      (value) => ({value}),
      () => undefined,
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PAGE_PATIENCE_MS)),
  ]);
  if (quick) return quick.value;

  // Slow (null) or failed (undefined): the last good copy, however old.
  const lastGood =
    (lastGoodLocal.get(key) as T | undefined) ??
    (SHARED_CACHE ? await readShared<T>(lastGoodKey) : null);
  if (lastGood != null && isUsableCachedValue(lastGood, allowsEmpty(options))) return lastGood;

  // Never built anywhere: a stand-in if the page has one, else wait for this
  // build (or its error).
  const standIn = options?.standIn ? await options.standIn().catch(() => null) : null;
  if (standIn != null) return standIn;
  return build;
}

/**
 * When each page's last good copy was built (ms since epoch), for the health
 * page. Recorded with the copy, so it is at most a minute behind the newest build.
 */
export async function lastBuiltAt(keys: string[]): Promise<Map<string, number>> {
  if (!SHARED_CACHE) return new Map();
  return readManyShared<number>(keys.map((key) => `built-at:${key}`)).then(
    (found) =>
      new Map(
        keys.flatMap((key) => {
          const at = found.get(`built-at:${key}`);
          return typeof at === "number" ? [[key, at] as const] : [];
        }),
      ),
  );
}

/** Another page's last good copy, if one has ever been built (see cachedPage). */
export async function readLastGood<T>(key: string): Promise<T | null> {
  const local = lastGoodLocal.get(key) as T | undefined;
  if (local != null) return local;
  return SHARED_CACHE ? readShared<T>(`last-good:${key}`) : null;
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
  options?: CacheOptions,
): Promise<T> {
  const shared = await readShared<T>(key);
  if (!isUsableCachedValue(shared, allowsEmpty(options))) {
    return refresh(key, ttlMs, load, options);
  }

  // Warm this instance from it, then refresh behind the caller so the shared
  // copy does not go stale for everyone at once.
  store.set(key, {value: shared, expires: Date.now() + ttlMs});
  void refresh(key, ttlMs, load, options).catch(() => {});
  return shared;
}

/** Loads, stores, and clears its own in-flight marker. */
function refresh<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options?: CacheOptions,
): Promise<T> {
  const promise = load()
    .then((value) => {
      if (isUsableCachedValue(value, allowsEmpty(options))) {
        store.set(key, {value, expires: Date.now() + ttlMs});
        // Written behind the caller, and kept a good deal longer than the local
        // copy: its job is to spare the *next* cold instance the rebuild, so it
        // needs to outlive the freshness window rather than match it.
        if (SHARED_CACHE) {
          keepAlive(writeShared(key, value, sharedTtlSeconds(ttlMs, options)));
        }
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
  keepAlive(promise);
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

/** Test-only: drop in-process entries so cases do not leak into each other. */
export function resetLiveCacheForTests(): void {
  store.clear();
  inflight.clear();
  lastGoodLocal.clear();
  lastGoodWrittenAt.clear();
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
    if (!res.ok) {
      // Drop the query string so tokens in `?token=` never land in logs.
      const safe = url.split("?")[0] ?? url;
      throw new Error(`${safe} -> ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
