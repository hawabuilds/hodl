import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {featuredRwa, newsForTickers, sliceToRange} from "../src/lib/homeSummary";
import type {FeedItem, RwaAsset, TokenAsset} from "../src/lib/types";

const token = (symbol: string, pairedTicker: string, volume24hUsd: number | null) =>
  ({kind: "token", id: symbol, symbol, pairedTicker, volume24hUsd}) as unknown as TokenAsset;
const rwa = (ticker: string) => ({kind: "rwa", id: ticker, ticker}) as unknown as RwaAsset;
const story = (id: string, tickers: string[], minutesAgo: number) =>
  ({
    kind: "article",
    id,
    tickers,
    publishedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  }) as unknown as FeedItem;

describe("featured RWA", () => {
  it("is the RWA whose paired tokens traded most, not the busiest single token", () => {
    const tokens = [
      token("BIG", "TSLA", 900),
      token("A", "NVDA", 500),
      token("B", "NVDA", 450),
      token("C", "NVDA", null),
    ];
    const lead = featuredRwa(tokens, [rwa("NVDA"), rwa("TSLA")]);
    assert.equal(lead?.rwa.ticker, "NVDA");
    assert.equal(lead?.tokenVolumeUsd, 950);
    assert.deepEqual(lead?.paired.map((t) => t.symbol), ["A", "B", "C"]);
  });

  it("shows at most four paired tokens, busiest first", () => {
    const tokens = [1, 2, 3, 4, 5].map((n) => token(`T${n}`, "NVDA", n * 10));
    assert.deepEqual(featuredRwa(tokens, [rwa("NVDA")])?.paired.map((t) => t.symbol), [
      "T5",
      "T4",
      "T3",
      "T2",
    ]);
  });

  it("ignores tokens paired with something that is not a listed RWA", () => {
    assert.equal(featuredRwa([token("E", "WETH", 1_000)], [rwa("NVDA")]), null);
  });

  it("has no lead when nothing traded", () => {
    assert.equal(featuredRwa([token("Z", "NVDA", 0)], [rwa("NVDA")]), null);
  });
});

describe("chart range", () => {
  const HOUR = 3_600_000;
  const points = [0, 10, 20, 30, 40, 50].map((h) => ({t: h * HOUR, price: h + 1}));

  it("keeps the last span, measured back from the newest point", () => {
    assert.deepEqual(sliceToRange(points, 20 * HOUR).map((p) => p.price), [31, 41, 51]);
  });

  it("is empty for an empty series", () => {
    assert.deepEqual(sliceToRange([], HOUR), []);
  });
});

describe("home news", () => {
  it("leads with stories about the RWAs behind the trending tokens, newest first", () => {
    const items = [
      story("old-nvda", ["NVDA"], 90),
      story("aapl", ["AAPL"], 5),
      story("new-nvda", ["NVDA"], 10),
      story("no-ticker", [], 1),
    ];
    assert.deepEqual(newsForTickers(items, new Set(["NVDA"])).map((s) => s.id), [
      "new-nvda",
      "old-nvda",
      "aapl",
    ]);
  });

  it("never includes posts or stories that name no RWA", () => {
    const post = {...story("post", ["NVDA"], 1), kind: "account"} as FeedItem;
    assert.deepEqual(newsForTickers([post, story("bare", [], 2)], new Set(["NVDA"])), []);
  });
});
