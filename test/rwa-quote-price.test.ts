import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {parseQuote, quotePrice} from "../src/lib/server/live/robinhood.ts";

describe("stock price from a Robinhood quote", () => {
  it("a normal spread is the plain mid", () => {
    assert.equal(quotePrice(231.71, 234.23, 231.16, 237.87), (231.71 + 234.23) / 2);
    assert.equal(quotePrice(24.8, 25.2, 23.885, 25.25), 25);
  });

  it("an empty book out of hours stays where the stock traded (AMC: bid 2.72 / ask 11.80)", () => {
    const price = quotePrice(2.72, 11.8, 2.7125, 2.885);
    assert.ok(Math.abs(price - 2.8025) < 1e-9, String(price));
    // The old mid priced it, and every token paired with it, at 2.6×.
    assert.ok(price < 3);
  });

  it("a stale bid far below the day's range is held to it too (NET 130 / 356, day 345–355)", () => {
    assert.equal(quotePrice(130.07, 356.32, 345.0104, 355), (345.0104 + 355) / 2);
  });

  it("without a day's range, a wide spread falls back to the mid", () => {
    assert.equal(quotePrice(2, 4, null, null), 3);
  });

  it("parseQuote uses it", () => {
    const quote = parseQuote("AMC", {quotes: [{bid: "2.72", ask: "11.8", dailyHigh: "2.885", dailyLow: "2.7125"}]} as never);
    assert.ok(quote && Math.abs(quote.priceUsd - 2.8025) < 1e-9);
    assert.equal(quote?.bid, 2.72);
    assert.equal(quote?.ask, 11.8);
  });
});
