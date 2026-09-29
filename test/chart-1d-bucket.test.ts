import {afterEach, beforeEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  resetGeckoFetchForTests,
  setGeckoFetchSleepForTests,
} from "../src/lib/server/live/geckoFetch";
import {resetLiveCacheForTests} from "../src/lib/server/live/cache";
import {bucketForAge, candles} from "../src/lib/server/live/geckoterminal";

/**
 * A 1D chart for a young token walked 1D → 4h → 1h → 15m → 5m → 1m, one
 * request per rung, until something could draw. The token's age says where
 * that walk would stop, so the chart now starts there: one call, two at most.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: () => null},
    json: async () => body,
  } as unknown as Response;
}

const twoCandles = () => {
  const now = Math.floor(Date.now() / 1000);
  return {data: {attributes: {ohlcv_list: [[now - 60, 1, 1, 1, 1, 5], [now - 7200, 1, 1, 1, 1, 5]]}}};
};

describe("1D bucket from token age", () => {
  it("picks the coarsest bucket the token is old enough to have two of", () => {
    assert.equal(bucketForAge(3 * 24 * HOUR), "1D");
    assert.equal(bucketForAge(24 * HOUR), "4h");
    assert.equal(bucketForAge(3 * HOUR), "1h");
    assert.equal(bucketForAge(40 * MIN), "15m");
    assert.equal(bucketForAge(12 * MIN), "5m");
    assert.equal(bucketForAge(3 * MIN), "1m");
  });
});

describe("1D candles for a young token", () => {
  const originalFetch = globalThis.fetch;
  let urls: string[] = [];

  beforeEach(() => {
    resetGeckoFetchForTests();
    resetLiveCacheForTests();
    setGeckoFetchSleepForTests(async () => {});
    urls = [];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetGeckoFetchForTests();
    resetLiveCacheForTests();
  });

  const ohlcvCalls = () => urls.filter((url) => url.includes("/ohlcv/"));

  it("asks once, at the bucket its age allows", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonRes(200, twoCandles());
    }) as typeof fetch;

    const result = await candles("0xpool", "1D", "0xtoken", 10, undefined, Date.now() - 3 * HOUR);
    assert.equal(result.resolvedTimeframe, "1h");
    assert.equal(ohlcvCalls().length, 1);
    assert.ok(ohlcvCalls()[0].includes("/ohlcv/hour"));
  });

  it("steps one finer for a thin pool, and no further", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonRes(200, {data: {attributes: {ohlcv_list: []}}});
    }) as typeof fetch;

    const result = await candles("0xpool", "1D", "0xtoken", 10, undefined, Date.now() - 3 * HOUR);
    assert.equal(result.points.length, 0);
    assert.equal(result.error, null);
    assert.equal(ohlcvCalls().length, 2);
    assert.ok(ohlcvCalls()[1].includes("aggregate=15"));
  });

  it("stops at the first failure rather than walking on", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonRes(500, {});
    }) as typeof fetch;

    const result = await candles("0xpool", "1D", "0xtoken", 10, undefined, Date.now() - 3 * 24 * HOUR);
    assert.ok(result.error);
    assert.ok(ohlcvCalls().every((url) => url.includes("/ohlcv/day")));
  });
});
