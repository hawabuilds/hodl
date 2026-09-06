import {describe, it, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {
  cached,
  isUsableCachedValue,
  resetLiveCacheForTests,
} from "../src/lib/server/live/cache.ts";
import {hasArticles} from "../src/lib/server/live/news.ts";

describe("live cache empty arrays", () => {
  beforeEach(() => {
    resetLiveCacheForTests();
  });

  it("treats a shared empty array as a miss when cacheEmpty is off", () => {
    assert.equal(isUsableCachedValue(null, false), false);
    assert.equal(isUsableCachedValue([], false), false);
    assert.equal(isUsableCachedValue([{id: "a"}], false), true);
    // Other callers still cache a real empty — no trades, no pairs.
    assert.equal(isUsableCachedValue([], true), true);
    assert.equal(isUsableCachedValue([], undefined), true);
  });

  it("does not remember an empty feed, so the next caller rebuilds", async () => {
    let loads = 0;
    const empty = async () => {
      loads += 1;
      return [] as {id: string}[];
    };

    assert.deepEqual(await cached("fh:feed", 60_000, empty, {cacheEmpty: false}), []);
    assert.deepEqual(await cached("fh:feed", 60_000, empty, {cacheEmpty: false}), []);
    assert.equal(loads, 2);
  });

  it("keeps a non-empty feed and does not reload inside the TTL", async () => {
    let loads = 0;
    const items = await cached(
      "fh:feed",
      60_000,
      async () => {
        loads += 1;
        return [{id: "story"}];
      },
      {cacheEmpty: false},
    );

    const again = await cached(
      "fh:feed",
      60_000,
      async () => {
        loads += 1;
        return [{id: "other"}];
      },
      {cacheEmpty: false},
    );

    assert.deepEqual(items, [{id: "story"}]);
    assert.deepEqual(again, [{id: "story"}]);
    assert.equal(loads, 1);
  });

  it("treats an X-only feed as not a cached wire win", () => {
    assert.equal(hasArticles([]), false);
    assert.equal(
      hasArticles([{id: "x-1", kind: "account"} as never]),
      false,
    );
    assert.equal(
      hasArticles([{id: "fh-1", kind: "article"} as never]),
      true,
    );
  });

  it("still caches empty arrays by default", async () => {
    let loads = 0;
    await cached("pairs:demo", 60_000, async () => {
      loads += 1;
      return [];
    });
    await cached("pairs:demo", 60_000, async () => {
      loads += 1;
      return [{id: "should-not-run"}];
    });
    assert.equal(loads, 1);
  });
});
