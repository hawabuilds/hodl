import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {newsTime, relativeTime, startOfLocalDay} from "../src/lib/format";
import {
  NEWS_BUILD_FRESH_MS,
  NEWS_FEED_QUERY_KEY,
  NEWS_WINDOW_MS,
  selectTodayStories,
} from "../src/lib/newsWindow";

describe("newsTime", () => {
  const nowDate = new Date(2026, 8, 8, 16, 30, 0);
  const now = nowDate.getTime();

  it("uses relative time for stories from the last few hours", () => {
    const twoHours = new Date(now - 2 * 3_600_000).toISOString();
    assert.equal(newsTime(twoHours, "24h", now), relativeTime(twoHours, now));
    assert.equal(newsTime(twoHours, "7d", now), relativeTime(twoHours, now));
  });

  it("prints the clock for older same-day stories instead of 8h ago", () => {
    const sixHours = new Date(now - 6 * 3_600_000).toISOString();
    assert.notEqual(newsTime(sixHours, "24h", now), relativeTime(sixHours, now));
    assert.match(newsTime(sixHours, "24h", now), /\d/);
    assert.doesNotMatch(newsTime(sixHours, "24h", now), /ago/);
  });

  it("prints a weekday on This week once the day has rolled", () => {
    const threeDays = new Date(now - 3 * 86_400_000).toISOString();
    assert.notEqual(newsTime(threeDays, "7d", now), relativeTime(threeDays, now));
    assert.match(newsTime(threeDays, "7d", now), /[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}/);
  });

  it("start of local day is midnight on the same calendar date", () => {
    const start = new Date(startOfLocalDay(now));
    assert.equal(start.getHours(), 0);
    assert.equal(start.getDate(), nowDate.getDate());
  });
});

describe("selectTodayStories", () => {
  const nowDate = new Date(2026, 8, 8, 20, 36, 0);
  const now = nowDate.getTime();
  const start = startOfLocalDay(now);

  it("keeps this local calendar day's stories", () => {
    const morning = {publishedAt: new Date(start + 9 * 3_600_000).toISOString()};
    const lastNight = {publishedAt: new Date(start - 60 * 60_000).toISOString()};
    assert.deepEqual(selectTodayStories([morning, lastNight], now), [morning]);
  });

  it("does not empty Today when the only 24h items are from last night", () => {
    // Production glitch: rolling 24h held one X post from 22:00 UTC yesterday,
    // local midnight dropped it, and the tab said "Nothing in this window".
    const lastNight = {publishedAt: new Date(start - 60 * 60_000).toISOString()};
    assert.deepEqual(selectTodayStories([lastNight], now), [lastNight]);
  });

  it("does not drop a story whose publishedAt cannot be parsed", () => {
    const broken = {publishedAt: "not-a-date"};
    assert.deepEqual(selectTodayStories([broken], now), [broken]);
  });

  it("fetches a wider Today window than a rolling 24h so local midnight overlaps", () => {
    assert.ok(NEWS_WINDOW_MS["24h"] > 24 * 3_600_000);
    assert.equal(NEWS_WINDOW_MS["24h"], 48 * 3_600_000);
  });

  it("keeps this evening's wire on Today instead of falling back to last night", () => {
    const evening = {publishedAt: new Date(start + 20 * 3_600_000).toISOString()};
    const afternoon = {publishedAt: new Date(start + 19 * 3_600_000).toISOString()};
    const lastNight = {publishedAt: new Date(start - 60 * 60_000).toISOString()};
    assert.deepEqual(
      selectTodayStories([evening, afternoon, lastNight], now),
      [evening, afternoon],
    );
  });

  it("busts the client cache key with the wire refresh", () => {
    assert.equal(NEWS_FEED_QUERY_KEY, "news-feed-v10");
    assert.ok(NEWS_BUILD_FRESH_MS <= 2 * 60_000);
  });
});
