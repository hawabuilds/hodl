import {afterEach, beforeEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  GECKO_DEFAULT_429_MS,
  GECKO_MAX_RETRY_WAIT_MS,
  geckoBackoffMs,
  geckoFetch,
  isGeckoRateLimited,
  parseRetryAfterMs,
  resetGeckoFetchForTests,
  setGeckoFetchSleepForTests,
  shouldRetryGecko429,
} from "../src/lib/server/live/geckoFetch";
import {resetLiveCacheForTests} from "../src/lib/server/live/cache";
import {candles, FREE_GECKO_BASE} from "../src/lib/server/live/geckoterminal";

const BASE = "https://api.geckoterminal.com/api/v2";

function jsonRes(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name: string) => lower[name.toLowerCase()] ?? null},
    json: async () => body,
  } as Response;
}

describe("gecko fetch limiter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetGeckoFetchForTests();
    resetLiveCacheForTests();
    setGeckoFetchSleepForTests(async () => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetGeckoFetchForTests();
    resetLiveCacheForTests();
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    assert.equal(parseRetryAfterMs("2"), 2_000);
    assert.equal(parseRetryAfterMs(null), GECKO_DEFAULT_429_MS);
    const later = Date.now() + 8_000;
    const wait = parseRetryAfterMs(new Date(later).toUTCString(), Date.now());
    assert.ok(wait >= 7_000 && wait <= 8_000);
  });

  it("retries a missing or short Retry-After, not a long one", () => {
    assert.equal(shouldRetryGecko429(null), true);
    assert.equal(shouldRetryGecko429(300), true);
    assert.equal(shouldRetryGecko429(GECKO_MAX_RETRY_WAIT_MS), true);
    assert.equal(shouldRetryGecko429(30_000), false);
    const delay = geckoBackoffMs(0, 300, () => 0.5);
    assert.equal(delay, 300);
  });

  it("serves last good after a 429 and then cools without refetching", async () => {
    let hits = 0;
    globalThis.fetch = (async () => {
      hits += 1;
      if (hits === 1) return jsonRes(200, {ok: true});
      return jsonRes(429, {}, {"retry-after": "30"});
    }) as typeof fetch;

    const first = await geckoFetch<{ok: boolean}>({
      base: BASE,
      path: "/networks/robinhood/pools/0x1/ohlcv/minute",
      host: "free",
    });
    assert.equal(first.fromCache, false);
    assert.deepEqual(first.body, {ok: true});

    const limited = await geckoFetch<{ok: boolean}>({
      base: BASE,
      path: "/networks/robinhood/pools/0x1/ohlcv/minute",
      host: "free",
    });
    assert.equal(limited.fromCache, true);
    assert.deepEqual(limited.body, {ok: true});
    assert.equal(hits, 2);
    assert.equal(isGeckoRateLimited(), true);

    const cooled = await geckoFetch<{ok: boolean}>({
      base: BASE,
      path: "/networks/robinhood/pools/0x1/ohlcv/minute",
      host: "free",
    });
    assert.equal(cooled.fromCache, true);
    assert.deepEqual(cooled.body, {ok: true});
    assert.equal(hits, 2);
  });

  it("dedupes in-flight requests for the same URL", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async () => {
      started += 1;
      await gate;
      return jsonRes(200, {n: started});
    }) as typeof fetch;

    const a = geckoFetch<{n: number}>({base: BASE, path: "/same", host: "free"});
    const b = geckoFetch<{n: number}>({base: BASE, path: "/same", host: "free"});
    await Promise.resolve();
    assert.equal(started, 1);
    release();
    const [left, right] = await Promise.all([a, b]);
    assert.equal(started, 1);
    assert.deepEqual(left.body, {n: 1});
    assert.deepEqual(right.body, {n: 1});
  });

  it("retries once with backoff when Retry-After is absent", async () => {
    const sleeps: number[] = [];
    setGeckoFetchSleepForTests(async (ms) => {
      sleeps.push(ms);
    });
    let hits = 0;
    globalThis.fetch = (async () => {
      hits += 1;
      if (hits === 1) return jsonRes(429);
      return jsonRes(200, {ok: true});
    }) as typeof fetch;

    const result = await geckoFetch<{ok: boolean}>({
      base: BASE,
      path: "/retry",
      host: "free",
    });
    assert.equal(hits, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 0 && sleeps[0] <= GECKO_MAX_RETRY_WAIT_MS);
    assert.deepEqual(result.body, {ok: true});
  });

  it("does not retry-storm when Retry-After is long", async () => {
    const sleeps: number[] = [];
    setGeckoFetchSleepForTests(async (ms) => {
      sleeps.push(ms);
    });
    let hits = 0;
    globalThis.fetch = (async () => {
      hits += 1;
      return jsonRes(429, {}, {"retry-after": "30"});
    }) as typeof fetch;

    const result = await geckoFetch({base: BASE, path: "/long", host: "free"});
    assert.equal(hits, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(result.status, 429);
    assert.equal(result.body, null);
    assert.equal(isGeckoRateLimited(), true);
  });

  it("stops the 1D candle ladder after a 429", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonRes(429, {}, {"retry-after": "30"});
    }) as typeof fetch;

    const result = await candles("0xpool", "1D", "0xtoken", 10);
    assert.equal(result.points.length, 0);
    assert.match(result.error ?? "", /rate-limited/);
    const ohlcv = urls.filter((url) => url.includes("/ohlcv/"));
    assert.ok(ohlcv.length >= 1 && ohlcv.length <= 2);
    assert.ok(ohlcv.every((url) => url.includes("/ohlcv/day")));
    assert.ok(!urls.some((url) => url.includes("/ohlcv/hour")));
    assert.ok(!urls.some((url) => url.includes("aggregate=")));
    assert.ok(ohlcv.some((url) => url.startsWith(FREE_GECKO_BASE)));
    assert.ok(ohlcv.every((url) => url.includes("token=0xtoken")));
  });
});
