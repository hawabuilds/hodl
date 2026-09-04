import assert from "node:assert/strict";
import test from "node:test";

import {encodeForShared, decodeFromShared} from "../src/lib/server/live/shared.ts";

/**
 * What crosses the wire to the shared cache and back.
 *
 * A Map does not survive `JSON.stringify` — it becomes `"{}"` — and two of the
 * values held in this cache are Maps. A cold instance reading one back got an
 * object with no `.get` on it, which is how stock quotes went missing and how
 * the portfolio route threw in production.
 */

test("a Map survives the round trip", () => {
  const quotes = new Map([
    ["AAPL", {priceUsd: 250.5}],
    ["GOOGL", {priceUsd: 342.68}],
  ]);

  const back = decodeFromShared<Map<string, {priceUsd: number}>>(
    encodeForShared(quotes),
  );

  assert.ok(back instanceof Map, "should come back as a Map");
  assert.equal(back.get("GOOGL")?.priceUsd, 342.68);
  assert.equal(back.size, 2);
});

test("plain JSON stringify is what broke it", () => {
  // The behaviour this codec exists to work around.
  assert.equal(JSON.stringify(new Map([["a", 1]])), "{}");
});

test("a nested Map survives too", () => {
  const value = {supplies: new Map([["0xa", 1_000n.toString()]]), n: 3};
  const back = decodeFromShared<typeof value>(encodeForShared(value));
  assert.ok(back.supplies instanceof Map);
  assert.equal(back.supplies.get("0xa"), "1000");
  assert.equal(back.n, 3);
});

test("an empty Map is still a Map", () => {
  const back = decodeFromShared<Map<string, number>>(
    encodeForShared(new Map<string, number>()),
  );
  assert.ok(back instanceof Map);
  assert.equal(back.size, 0);
});

test("ordinary values are untouched", () => {
  for (const value of [
    42,
    "hello",
    true,
    null,
    [1, 2, 3],
    {a: 1, b: {c: 2}},
  ]) {
    assert.deepEqual(decodeFromShared(encodeForShared(value)), value);
  }
});

test("a plain object is not mistaken for a Map", () => {
  // Only the codec's own tag revives, so data that merely looks map-shaped
  // comes back as the object it was.
  const lookalike = {__map__: "not an array of entries"};
  const back = decodeFromShared<typeof lookalike>(encodeForShared(lookalike));
  assert.ok(!(back instanceof Map));
  assert.equal(back.__map__, "not an array of entries");
});
