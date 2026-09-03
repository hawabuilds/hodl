import assert from "node:assert/strict";
import test from "node:test";

import {marketCapAt, supplyOf} from "../src/lib/marketCap.ts";
import {
  publishPrice,
  publishPrices,
  priceFor,
  readingFor,
  resetPrices,
  subscribe,
} from "../src/lib/livePrice.ts";

/**
 * The market cap contract.
 *
 * These cover the two things that made the feed and the chart page disagree:
 * a second calculation, and a second price that could arrive out of order.
 */

const token = (over = {}) =>
  ({
    kind: "token",
    id: "0xAbC",
    marketCapUsd: 1_000_000,
    priceUsd: 0.001,
    circulatingSupply: 1_000_000_000,
    ...over,
  }) as never;

test("market cap is supply times price", () => {
  assert.equal(marketCapAt(token(), 0.001), 1_000_000);
  assert.equal(marketCapAt(token(), 0.002), 2_000_000);
});

test("the same asset and price give the same cap on every surface", () => {
  const asset = token();
  const price = 0.00137;
  // Whatever calls it — feed row, chart header, info panel — is one function.
  assert.equal(marketCapAt(asset, price), marketCapAt(asset, price));
  assert.equal(marketCapAt(asset, price), 1_370_000);
});

test("without a known supply the server's figure is returned unrescaled", () => {
  // This is the case that printed caps in the billions: the cap came from the
  // indexer, so dividing it by price invented a supply that never existed.
  const noSupply = token({circulatingSupply: null, marketCapUsd: 144_400});
  assert.equal(supplyOf(noSupply), null);
  assert.equal(marketCapAt(noSupply, 0.005), 144_400);
  assert.equal(marketCapAt(noSupply, 99), 144_400);
});

test("a nonsense price never produces a nonsense cap", () => {
  assert.equal(marketCapAt(token(), 0), 1_000_000);
  assert.equal(marketCapAt(token(), -1), 1_000_000);
  assert.equal(marketCapAt(token(), Number.NaN), 1_000_000);
});

test("supply of zero or a negative is treated as unknown, not as zero", () => {
  assert.equal(supplyOf(token({circulatingSupply: 0})), null);
  assert.equal(supplyOf(token({circulatingSupply: -5})), null);
});

test("a fresher price replaces an older one", (t) => {
  t.after(resetPrices);
  resetPrices();

  assert.equal(publishPrice("0xa", 1, 1_000), true);
  assert.equal(publishPrice("0xa", 2, 2_000), true);
  assert.equal(priceFor("0xa"), 2);
});

test("a stale price cannot overwrite a fresher one", (t) => {
  t.after(resetPrices);
  resetPrices();

  // The tape publishes a fill, then the ten-second feed poll lands carrying a
  // price built a minute ago. Arriving later must not make it win.
  publishPrice("0xa", 2, 2_000);
  assert.equal(publishPrice("0xa", 1, 1_000), false);
  assert.equal(priceFor("0xa"), 2);
});

test("a price of the same age does not churn the held reading", (t) => {
  t.after(resetPrices);
  resetPrices();

  publishPrice("0xa", 2, 2_000);
  assert.equal(publishPrice("0xa", 9, 2_000), false);
  assert.equal(priceFor("0xa"), 2);
});

test("ids are matched regardless of address casing", (t) => {
  t.after(resetPrices);
  resetPrices();

  publishPrice("0xAbCdEf", 3, 1_000);
  assert.equal(priceFor("0xabcdef"), 3);
  assert.equal(priceFor("0xABCDEF"), 3);
});

test("unusable prices are refused", (t) => {
  t.after(resetPrices);
  resetPrices();

  assert.equal(publishPrice("0xa", 0, 1_000), false);
  assert.equal(publishPrice("0xa", -1, 1_000), false);
  assert.equal(publishPrice("0xa", Number.NaN, 1_000), false);
  assert.equal(publishPrice("0xa", 1, Number.NaN), false);
  assert.equal(priceFor("0xa"), null);
});

test("a batch applies each entry under the same staleness rule", (t) => {
  t.after(resetPrices);
  resetPrices();

  publishPrice("0xa", 5, 5_000);
  const accepted = publishPrices([
    {id: "0xa", price: 1, at: 1_000}, // stale, refused
    {id: "0xb", price: 2, at: 1_000}, // new, accepted
    {id: "0xc", price: 0, at: 1_000}, // unusable, refused
  ]);

  assert.equal(accepted, 1);
  assert.equal(priceFor("0xa"), 5);
  assert.equal(priceFor("0xb"), 2);
  assert.equal(priceFor("0xc"), null);
});

test("a batch notifies once, not once per entry", (t) => {
  t.after(resetPrices);
  resetPrices();

  let woken = 0;
  const stop = subscribe(() => {
    woken++;
  });

  publishPrices([
    {id: "0xa", price: 1, at: 1_000},
    {id: "0xb", price: 2, at: 1_000},
    {id: "0xc", price: 3, at: 1_000},
  ]);

  stop();
  assert.equal(woken, 1);
});

test("a batch that changes nothing wakes nobody", (t) => {
  t.after(resetPrices);
  resetPrices();

  publishPrices([{id: "0xa", price: 1, at: 5_000}]);

  let woken = 0;
  const stop = subscribe(() => {
    woken++;
  });
  publishPrices([{id: "0xa", price: 9, at: 1_000}]); // all stale
  stop();

  assert.equal(woken, 0);
});

test("the reading carries the moment the price was true", (t) => {
  t.after(resetPrices);
  resetPrices();

  publishPrice("0xa", 7, 4_242);
  assert.deepEqual(readingFor("0xa"), {price: 7, at: 4_242});
});

test("feed and chart page agree once both have published", (t) => {
  t.after(resetPrices);
  resetPrices();

  const asset = token({id: "0xfeed", circulatingSupply: 2_000_000_000});

  // Feed publishes a snapshot built a minute ago; the tape then publishes a
  // fill from two seconds ago. Both surfaces read the same store.
  publishPrices([{id: "0xfeed", price: 0.001, at: 60_000}]);
  publishPrice("0xfeed", 0.0012, 118_000);

  const canonical = priceFor("0xfeed")!;
  const homeRow = marketCapAt(asset, canonical);
  const chartHeader = marketCapAt(asset, canonical);
  const infoPanel = marketCapAt(asset, canonical);

  assert.equal(homeRow, chartHeader);
  assert.equal(chartHeader, infoPanel);
  assert.equal(homeRow, 2_400_000);
});
