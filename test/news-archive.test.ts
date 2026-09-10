import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  dedupeRowsById,
  mergeFeedItems,
  parseFinnhubId,
  type NewsArticleRow,
} from "../src/lib/server/live/newsArchive.ts";
import type {FeedItem} from "../src/lib/types";

function article(id: string, at: string, headline: string): FeedItem {
  return {
    id,
    kind: "article",
    body: headline,
    url: `https://example.com/${id}`,
    source: "Wire",
    handle: null,
    publishedAt: at,
    tickers: [],
    topic: "market",
    imageUrl: null,
    avatarUrl: null,
    sample: false,
    summary: null,
  };
}

describe("parseFinnhubId", () => {
  it("reads numeric Finnhub ids from fh- prefixed keys", () => {
    assert.equal(parseFinnhubId("fh-42"), 42);
    assert.equal(parseFinnhubId("fh-https://example.com/story"), null);
    assert.equal(parseFinnhubId("x-post"), null);
  });
});

function row(id: string, headline: string): NewsArticleRow {
  return {
    id,
    finnhub_id: parseFinnhubId(id),
    headline,
    summary: null,
    url: `https://example.com/${id}`,
    source: "Wire",
    image_url: null,
    published_at: "2026-09-08T20:00:00.000Z",
    topic: "market",
    tickers: [],
    fetched_at: "2026-09-08T20:05:00.000Z",
  };
}

describe("dedupeRowsById", () => {
  // Postgres aborts the whole ON CONFLICT batch if one id repeats, so a wire
  // article carried under two tickers used to sink every row with it.
  it("collapses repeated ids so the upsert stays one row per id", () => {
    const rows = dedupeRowsById([
      row("fh-1", "First"),
      row("fh-2", "Other"),
      row("fh-1", "Same article under a second ticker"),
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      ["fh-1", "fh-2"],
    );
  });

  it("keeps the last copy of a repeated id", () => {
    const rows = dedupeRowsById([row("fh-1", "stale"), row("fh-1", "fresh")]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.headline, "fresh");
  });

  it("passes an already-unique batch through untouched", () => {
    assert.equal(dedupeRowsById([row("fh-1", "a"), row("fh-2", "b")]).length, 2);
    assert.equal(dedupeRowsById([]).length, 0);
  });
});

describe("mergeFeedItems", () => {
  it("prefers the first list on id collision so live wire wins", () => {
    const live = [article("fh-1", "2026-09-08T20:00:00.000Z", "Live headline")];
    const archived = [
      article("fh-1", "2026-09-08T19:00:00.000Z", "Archived headline"),
      article("fh-2", "2026-09-08T18:00:00.000Z", "Older story"),
    ];
    const merged = mergeFeedItems(live, archived);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.body, "Live headline");
    assert.equal(merged[1]?.id, "fh-2");
  });
});
