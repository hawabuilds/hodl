import assert from "node:assert/strict";
import {beforeEach, describe, it} from "node:test";

import {cachedPage, forget, resetLiveCacheForTests} from "../src/lib/server/live/cache.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cachedPage: never an error once a page has been built", () => {
  beforeEach(() => resetLiveCacheForTests());

  it("answers straight from a quick build", async () => {
    assert.deepEqual(await cachedPage("p1", 10_000, async () => ({rows: 1})), {rows: 1});
  });

  it("serves the last good copy when a fresh build fails", async () => {
    await cachedPage("p2", 10_000, async () => ({rows: "good"}));
    // A fresh server: nothing fresh in the cache, and the rebuild fails.
    forget("p2");
    const answer = await cachedPage("p2", 10_000, async () => {
      throw new Error("upstream down");
    });
    assert.deepEqual(answer, {rows: "good"});
  });

  it("serves the last good copy instead of waiting on a slow build", async () => {
    await cachedPage("p3", 10_000, async () => ({rows: "old"}));
    forget("p3");
    const started = Date.now();
    const answer = await cachedPage("p3", 10_000, async () => {
      await sleep(4_000);
      return {rows: "new"};
    });
    assert.deepEqual(answer, {rows: "old"});
    assert.ok(Date.now() - started < 3_000, "did not wait for the slow build");
  });

  it("still waits for (or fails with) a page never built before", async () => {
    await assert.rejects(
      cachedPage("p4", 10_000, async () => {
        throw new Error("upstream down");
      }),
      /upstream down/,
    );
    assert.deepEqual(
      await cachedPage("p5", 10_000, async () => {
        await sleep(1_800);
        return {rows: "first"};
      }),
      {rows: "first"},
    );
  });

  it("shows a never-built page's stand-in instead of waiting or failing", async () => {
    const started = Date.now();
    const slow = await cachedPage(
      "p6",
      10_000,
      async () => {
        await sleep(4_000);
        return {rows: "real"};
      },
      {standIn: async () => ({rows: "stand-in"})},
    );
    assert.deepEqual(slow, {rows: "stand-in"});
    assert.ok(Date.now() - started < 3_000, "did not wait for the slow build");
    const failed = await cachedPage(
      "p7",
      10_000,
      async () => {
        throw new Error("upstream down");
      },
      {standIn: async () => ({rows: "stand-in"})},
    );
    assert.deepEqual(failed, {rows: "stand-in"});
  });
});
