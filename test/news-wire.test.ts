import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  canServeWithoutWire,
  classifyWireCopy,
  finnhubDate,
  mapFinnhubToFeedItem,
  newestAgeMs,
  WIRE_CACHE_KEY,
  WIRE_SHARED_TTL_SECONDS,
  WIRE_TTL_MS,
} from "../src/lib/server/live/news.ts";
import type {FeedItem} from "../src/lib/types";

describe("classifyWireCopy", () => {
  it("drops geopolitics that never mention markets or a covered stock", () => {
    assert.equal(
      classifyWireCopy("US issues fresh Iran-related sanctions, Treasury website shows"),
      null,
    );
    assert.equal(
      classifyWireCopy("Who are the Houthis, Iran’s allies in Yemen?"),
      null,
    );
    assert.equal(
      classifyWireCopy("What to know about Trump's unusual midterm convention"),
      null,
    );
    assert.equal(
      classifyWireCopy("EU's von der Leyen slams turnout for Mladic's funeral"),
      null,
    );
  });

  it("keeps this evening's close recap as Markets, not politics", () => {
    assert.deepEqual(
      classifyWireCopy(
        "Wall Street slides, oil surges amid worries over inflation, Middle East",
        "",
        "",
        "Reuters",
      ),
      {topic: "market", tickers: []},
    );
    assert.deepEqual(
      classifyWireCopy(
        "This alternative energy stock is more popular than SpaceX in the options pits. Here's why",
        "",
        "",
        "CNBC",
      ),
      {topic: "market", tickers: []},
    );
  });

  it("keeps oil and index stories in Top stories, not RWA stocks", () => {
    assert.deepEqual(
      classifyWireCopy("Oil hits multi-week highs after Houthi attacks on Saudi energy facilities"),
      {topic: "market", tickers: []},
    );
    assert.deepEqual(
      classifyWireCopy("Stocks fall as yen firms; Gulf attacks send oil towards $100 a barrel"),
      {topic: "market", tickers: []},
    );
    assert.deepEqual(
      classifyWireCopy("Jim Cramer's top 10 things to watch in the stock market Tuesday"),
      {topic: "market", tickers: []},
    );
  });

  it("tags covered names as RWA and Robinhood as Robinhood", () => {
    const apple = classifyWireCopy("How Apple stock usually reacts to big iPhone reveal events");
    assert.equal(apple?.topic, "rwa");
    assert.ok(apple?.tickers.includes("AAPL"));

    const nvidia = classifyWireCopy(
      "Nvidia-backed Firmus signs deal with OpenAI for Malaysia data centre capacity",
    );
    assert.equal(nvidia?.topic, "rwa");
    assert.ok(nvidia?.tickers.includes("NVDA"));

    assert.deepEqual(
      classifyWireCopy("Robinhood Partners with Crypto.com to Expand Prediction Markets"),
      {topic: "robinhood", tickers: []},
    );
  });

  it("does not treat English words like now as ServiceNow", () => {
    assert.equal(
      classifyWireCopy("Investigators recover black boxes from cargo plane crash in Miami"),
      null,
    );
  });

  it("keeps a financial-outlet story as Markets, not RWA", () => {
    assert.deepEqual(
      classifyWireCopy("What traders are watching this morning", "", "", "Reuters"),
      {topic: "market", tickers: []},
    );
  });

  it("still drops pure politics even from Reuters", () => {
    assert.equal(
      classifyWireCopy(
        "US issues fresh Iran-related sanctions, Treasury website shows",
        "",
        "",
        "Reuters",
      ),
      null,
    );
  });
});

describe("mapFinnhubToFeedItem", () => {
  it("passes Finnhub summary through and drops blank copy", () => {
    const withSummary = mapFinnhubToFeedItem(
      {
        id: 42,
        datetime: 1_757_359_200,
        headline: "Apple unveils new iPhone",
        summary: "  Cupertino event highlights AI features.  ",
        url: "https://example.com/apple",
        source: "Reuters",
      },
      "rwa",
      ["AAPL"],
    );
    assert.equal(withSummary?.summary, "Cupertino event highlights AI features.");

    const withoutSummary = mapFinnhubToFeedItem(
      {
        id: 43,
        datetime: 1_757_359_200,
        headline: "Markets close mixed",
        summary: "   ",
        url: "https://example.com/markets",
        source: "CNBC",
      },
      "market",
      [],
    );
    assert.equal(withoutSummary?.summary, null);
  });
});

describe("finnhubDate", () => {
  it("accepts unix seconds as a number or a string", () => {
    const seconds = 1_757_359_200;
    const fromNumber = finnhubDate(seconds);
    const fromString = finnhubDate(String(seconds));
    assert.ok(fromNumber);
    assert.equal(fromNumber, fromString);
    assert.equal(fromNumber, new Date(seconds * 1000).toISOString());
  });

  it("drops missing or zero stamps so they do not sort as 1970", () => {
    assert.equal(finnhubDate(undefined), null);
    assert.equal(finnhubDate(0), null);
    assert.equal(finnhubDate(""), null);
    assert.equal(finnhubDate("nope"), null);
  });
});

describe("wire cache freshness", () => {
  it("does not pin a wire snapshot for an hour in Redis", () => {
    assert.ok(WIRE_TTL_MS <= 3 * 60_000);
    assert.ok(WIRE_SHARED_TTL_SECONDS <= 5 * 60);
    assert.ok(WIRE_SHARED_TTL_SECONDS * 1000 < 10 * WIRE_TTL_MS);
    assert.match(WIRE_CACHE_KEY, /v10/);
  });

  it("measures newest story age so a 19:03 snapshot is obviously stale at 21:20", () => {
    const now = Date.parse("2026-09-08T21:20:00.000Z");
    const evening = {publishedAt: "2026-09-08T20:23:21.000Z"};
    const stuck = {publishedAt: "2026-09-08T19:03:06.000Z"};
    assert.ok(newestAgeMs([evening], now) < 60 * 60_000);
    assert.ok(newestAgeMs([stuck], now) > 2 * 60 * 60_000);
    assert.equal(newestAgeMs([], now), Infinity);
  });
});

describe("canServeWithoutWire", () => {
  const article = (id: string): FeedItem => ({
    id,
    kind: "article",
    body: "Headline",
    url: `https://example.com/${id}`,
    source: "Wire",
    handle: null,
    publishedAt: "2026-09-10T20:00:00.000Z",
    tickers: [],
    topic: "market",
    imageUrl: null,
    avatarUrl: null,
    sample: false,
    summary: null,
  });
  const post = (id: string): FeedItem => ({...article(id), kind: "account"});

  it("serves from the archive alone, so a cold wire rebuilds behind", () => {
    assert.equal(canServeWithoutWire([article("fh-1")], []), true);
  });

  it("serves from a wire already on hand even with no archive", () => {
    assert.equal(canServeWithoutWire([], [article("fh-2")]), true);
  });

  // Both empty is the one case worth blocking for: there is nothing to send.
  it("waits when neither source has an article", () => {
    assert.equal(canServeWithoutWire([], []), false);
  });

  // Posts are not articles; a feed of only X posts is the empty-wire case.
  it("does not count account posts as something to serve", () => {
    assert.equal(canServeWithoutWire([], [post("x-1")]), false);
  });
});
