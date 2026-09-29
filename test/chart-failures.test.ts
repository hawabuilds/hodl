import {afterEach, beforeEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  resetGeckoFetchForTests,
  setGeckoFetchSleepForTests,
} from "../src/lib/server/live/geckoFetch";
import {resetLiveCacheForTests} from "../src/lib/server/live/cache";
import {GECKO_PANEL_BUDGET_MS, candles} from "../src/lib/server/live/geckoterminal";

/**
 * When the Pro plan ran out, charts went blank for hours with no error.
 *
 * `candlesAt` caught every failure and returned an empty list, so a chart that
 * could not be loaded and a pool with no candles looked the same, and only a
 * 429 on the free host (by way of its cooldown) ever surfaced as an error.
 */

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: () => null},
    json: async () => body,
  } as unknown as Response;
}

const ohlcv = (rows: number[][]) => ({data: {attributes: {ohlcv_list: rows}}});

describe("chart failures are errors, not blank charts", () => {
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

  it("reports a host failure that is not a rate limit", async () => {
    globalThis.fetch = (async () => jsonRes(500, {})) as typeof fetch;
    const result = await candles("0xpool", "5m", "0xtoken", 10);
    assert.equal(result.points.length, 0);
    assert.match(result.error ?? "", /returned 500/);
  });

  it("reports a network failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const result = await candles("0xpool", "1h", "0xtoken", 10);
    assert.equal(result.points.length, 0);
    assert.ok(result.error, "a failed load came back without an error");
  });

  it("gives up on a host that never answers within the panel budget", async () => {
    // Each attempt used to be allowed 8s, twice per host: a chart could wait
    // half a minute to learn it had failed.
    globalThis.fetch = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const started = Date.now();
    const result = await candles("0xpool", "15m", "0xtoken", 10);
    const took = Date.now() - started;
    assert.equal(result.points.length, 0);
    assert.ok(result.error, "a timed-out load came back without an error");
    assert.ok(took < GECKO_PANEL_BUDGET_MS + 500, `took ${took}ms`);
  });

  it("keeps an empty pool empty, with no error", async () => {
    globalThis.fetch = (async () => jsonRes(200, ohlcv([]))) as typeof fetch;
    const result = await candles("0xpool", "5m", "0xtoken", 10);
    assert.equal(result.points.length, 0);
    assert.equal(result.error, null);
  });

  it("serves the last good candles when the host then fails", async () => {
    const now = Math.floor(Date.now() / 1000);
    let fail = false;
    globalThis.fetch = (async () =>
      fail
        ? jsonRes(500, {})
        : jsonRes(
            200,
            ohlcv([
              [now - 60, 1, 1, 1, 1, 10],
              [now - 120, 1, 1, 1, 1, 10],
            ]),
          )) as typeof fetch;

    const first = await candles("0xpool", "1m", "0xtoken", 10);
    assert.equal(first.points.length, 2);

    fail = true;
    resetGeckoFetchForTests();
    setGeckoFetchSleepForTests(async () => {});
    // Past the fresh-cache window, so the load really runs and fails.
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 60_000;
    try {
      const second = await candles("0xpool", "1m", "0xtoken", 10);
      assert.equal(second.points.length, 2);
      assert.equal(second.error, null);
    } finally {
      Date.now = realNow;
    }
  });
});
