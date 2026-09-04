import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {newsTime, relativeTime} from "../src/lib/format";

describe("newsTime", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");

  it("keeps Today and longer windows on relative time", () => {
    const sixHours = new Date(now - 6 * 3_600_000).toISOString();
    const twelveDays = new Date(now - 12 * 86_400_000).toISOString();
    assert.equal(newsTime(sixHours, "24h", now), relativeTime(sixHours, now));
    assert.equal(newsTime(twelveDays, "30d", now), relativeTime(twelveDays, now));
    assert.equal(newsTime(twelveDays, "all", now), relativeTime(twelveDays, now));
  });

  it("prints a weekday on This week instead of Nd ago", () => {
    const threeDays = new Date(now - 3 * 86_400_000).toISOString();
    assert.notEqual(newsTime(threeDays, "7d", now), relativeTime(threeDays, now));
    assert.match(newsTime(threeDays, "7d", now), /[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}/);
  });

  it("still uses relative time for stories from today in the week view", () => {
    const twoHours = new Date(now - 2 * 3_600_000).toISOString();
    assert.equal(newsTime(twoHours, "7d", now), relativeTime(twoHours, now));
  });
});
