/**
 * Shared GeckoTerminal / CoinGecko HTTP client.
 *
 * Chart, tape, images, pool lookup and the worker all used to call `fetch`
 * on their own. A 429 on one path then retried the next resolution, the
 * next decorate row, and the next poll — a stampede against a host that
 * allows roughly thirty public requests a minute.
 *
 * Every onchain call goes through here: one in-flight request per URL,
 * a last-good body to serve on 429, and a per-host cooldown that honors
 * Retry-After. Sleep-and-retry is capped at a short blip so a page never
 * sits on the old 30s hang.
 */

export const GECKO_FETCH_MS = 8_000;
export const GECKO_DEFAULT_429_MS = 15_000;
export const GECKO_MAX_COOLDOWN_MS = 60_000;
/** Longest this request will wait before one retry. Longer Retry-After cools others instead. */
export const GECKO_MAX_RETRY_WAIT_MS = 800;
export const GECKO_MAX_ATTEMPTS = 2;
export const GECKO_LAST_GOOD_MAX = 400;
export const GECKO_RATE_LIMIT_ERROR =
  "GeckoTerminal is rate-limited. Retry in a moment.";

export type GeckoFetchHost = "pro" | "free";

export type GeckoFetchResult<T> = {
  status: number;
  body: T | null;
  fromCache: boolean;
  attempted: boolean;
  retryAfterMs: number | null;
};

type LastGood = {body: unknown; at: number};

const cooldownUntil = new Map<GeckoFetchHost, number>();
const inflight = new Map<string, Promise<GeckoFetchResult<unknown>>>();
const lastGood = new Map<string, LastGood>();

let sleepImpl = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseRetryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number {
  if (!header?.trim()) return GECKO_DEFAULT_429_MS;
  const raw = header.trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, GECKO_MAX_COOLDOWN_MS);
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - now), GECKO_MAX_COOLDOWN_MS);
  }
  return GECKO_DEFAULT_429_MS;
}

export function geckoBackoffMs(
  attempt: number,
  retryAfterMs: number | null,
  random = Math.random,
): number {
  const exp = Math.min(300 * 2 ** Math.max(0, attempt), GECKO_MAX_RETRY_WAIT_MS);
  const floor = retryAfterMs ?? 0;
  const base = Math.max(exp, floor);
  const capped = Math.min(base, GECKO_MAX_RETRY_WAIT_MS);
  return Math.round(capped * (0.8 + random() * 0.4));
}

export function shouldRetryGecko429(retryAfterMs: number | null): boolean {
  return retryAfterMs == null || retryAfterMs <= GECKO_MAX_RETRY_WAIT_MS;
}

export function isGeckoCooling(host: GeckoFetchHost, now = Date.now()): boolean {
  return (cooldownUntil.get(host) ?? 0) > now;
}

/** True while the public host is in a 429 cooldown — stop ladders and decorate bursts. */
export function isGeckoRateLimited(now = Date.now()): boolean {
  return isGeckoCooling("free", now);
}

export function noteGecko429(
  host: GeckoFetchHost,
  retryAfterMs: number,
  now = Date.now(),
): void {
  const wait = Math.min(
    Math.max(retryAfterMs, 0) || GECKO_DEFAULT_429_MS,
    GECKO_MAX_COOLDOWN_MS,
  );
  const until = now + wait;
  const held = cooldownUntil.get(host) ?? 0;
  if (until > held) cooldownUntil.set(host, until);
}

export function geckoLastGood<T>(url: string): T | null {
  const hit = lastGood.get(url);
  return hit ? (hit.body as T) : null;
}

function rememberLastGood(url: string, body: unknown, now: number): void {
  if (lastGood.size >= GECKO_LAST_GOOD_MAX) {
    const oldest = lastGood.keys().next().value;
    if (oldest != null) lastGood.delete(oldest);
  }
  lastGood.set(url, {body, at: now});
}

function cachedBody<T>(url: string): GeckoFetchResult<T> | null {
  const body = geckoLastGood<T>(url);
  if (body == null) return null;
  return {
    status: 200,
    body,
    fromCache: true,
    attempted: false,
    retryAfterMs: null,
  };
}

export async function geckoFetch<T>(opts: {
  base: string;
  path: string;
  host: GeckoFetchHost;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<GeckoFetchResult<T>> {
  const url = `${opts.base}${opts.path}`;
  const pending = inflight.get(url) as Promise<GeckoFetchResult<T>> | undefined;
  if (pending) return pending;

  const run = fetchWithBackoff<T>(url, opts);
  inflight.set(url, run as Promise<GeckoFetchResult<unknown>>);
  try {
    return await run;
  } finally {
    inflight.delete(url);
  }
}

async function fetchWithBackoff<T>(
  url: string,
  opts: {
    host: GeckoFetchHost;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<GeckoFetchResult<T>> {
  const now = Date.now();
  if (isGeckoCooling(opts.host, now)) {
    return (
      cachedBody<T>(url) ?? {
        status: 429,
        body: null,
        fromCache: false,
        attempted: false,
        retryAfterMs: Math.max(0, (cooldownUntil.get(opts.host) ?? now) - now),
      }
    );
  }

  let lastRetryAfter: number | null = null;

  for (let attempt = 0; attempt < GECKO_MAX_ATTEMPTS; attempt++) {
    const result = await fetchOnce<T>(url, opts.headers ?? {}, opts.timeoutMs);
    if (result.status === 200 && result.body != null) {
      rememberLastGood(url, result.body, Date.now());
      return {
        status: 200,
        body: result.body,
        fromCache: false,
        attempted: true,
        retryAfterMs: null,
      };
    }

    if (result.status === 429) {
      lastRetryAfter = result.retryAfterMs;
      noteGecko429(opts.host, lastRetryAfter ?? GECKO_DEFAULT_429_MS);
      const cached = cachedBody<T>(url);
      if (cached) return {...cached, attempted: true, retryAfterMs: lastRetryAfter};
      if (
        attempt + 1 < GECKO_MAX_ATTEMPTS &&
        shouldRetryGecko429(lastRetryAfter)
      ) {
        await sleepImpl(geckoBackoffMs(attempt, lastRetryAfter));
        continue;
      }
      return {
        status: 429,
        body: null,
        fromCache: false,
        attempted: true,
        retryAfterMs: lastRetryAfter,
      };
    }

    if (
      (result.status === 0 || result.status >= 500) &&
      attempt + 1 < GECKO_MAX_ATTEMPTS
    ) {
      await sleepImpl(geckoBackoffMs(attempt, null));
      continue;
    }

    const cached = cachedBody<T>(url);
    if (cached && (result.status === 0 || result.status >= 500)) {
      return {...cached, attempted: true, retryAfterMs: lastRetryAfter};
    }

    return {
      status: result.status,
      body: null,
      fromCache: false,
      attempted: true,
      retryAfterMs: lastRetryAfter,
    };
  }

  return (
    cachedBody<T>(url) ?? {
      status: lastRetryAfter != null ? 429 : 0,
      body: null,
      fromCache: false,
      attempted: true,
      retryAfterMs: lastRetryAfter,
    }
  );
}

async function fetchOnce<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs = GECKO_FETCH_MS,
): Promise<{status: number; body: T | null; retryAfterMs: number | null}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {accept: "application/json", ...headers},
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 429) {
      const raw = res.headers.get("retry-after");
      return {
        status: 429,
        body: null,
        retryAfterMs: raw ? parseRetryAfterMs(raw) : null,
      };
    }
    if (!res.ok) return {status: res.status, body: null, retryAfterMs: null};
    return {status: res.status, body: (await res.json()) as T, retryAfterMs: null};
  } catch {
    return {status: 0, body: null, retryAfterMs: null};
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: drop cooldown, in-flight, and last-good so cases stay isolated. */
export function resetGeckoFetchForTests(): void {
  cooldownUntil.clear();
  inflight.clear();
  lastGood.clear();
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

export function setGeckoFetchSleepForTests(
  sleep: (ms: number) => Promise<void>,
): void {
  sleepImpl = sleep;
}
