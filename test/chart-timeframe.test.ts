import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  YOUNG_LISTING_MS,
  defaultChartTimeframe,
  isYoungListing,
  parseRequestedTimeframe,
} from "../src/lib/chartTimeframe";
import {assetHref, assetPath} from "../src/lib/routes";
import type {Asset} from "../src/lib/types";

const NOW = Date.parse("2026-09-06T16:00:00.000Z");

describe("chart timeframe default", () => {
  it("reads a valid ?tf= for tokens and ignores junk", () => {
    assert.equal(parseRequestedTimeframe("1m", "token"), "1m");
    assert.equal(parseRequestedTimeframe("1D", "token"), "1D");
    assert.equal(parseRequestedTimeframe("1w", "token"), null);
    assert.equal(parseRequestedTimeframe(undefined, "token"), null);
  });

  it("rejects 1m on RWA charts", () => {
    assert.equal(parseRequestedTimeframe("1m", "rwa"), null);
    assert.equal(parseRequestedTimeframe("5m", "rwa"), "5m");
  });

  it("treats listed_at inside 24h as a young listing", () => {
    assert.equal(
      isYoungListing(new Date(NOW - 6 * 60 * 60 * 1000).toISOString(), NOW),
      true,
    );
    assert.equal(
      isYoungListing(new Date(NOW - YOUNG_LISTING_MS + 1).toISOString(), NOW),
      true,
    );
    assert.equal(
      isYoungListing(new Date(NOW - YOUNG_LISTING_MS).toISOString(), NOW),
      false,
    );
    assert.equal(isYoungListing(null, NOW), false);
    assert.equal(isYoungListing("not-a-date", NOW), false);
  });

  it("opens 1m from a New-tab ?tf= even if listed_at is missing", () => {
    assert.equal(
      defaultChartTimeframe({kind: "token", requested: "1m", listedAt: null, now: NOW}),
      "1m",
    );
  });

  it("opens 1m for a young token with no interval in the URL", () => {
    assert.equal(
      defaultChartTimeframe({
        kind: "token",
        listedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
        now: NOW,
      }),
      "1m",
    );
  });

  it("keeps 1h for older tokens and any RWA without a valid ?tf=", () => {
    assert.equal(
      defaultChartTimeframe({
        kind: "token",
        listedAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
        now: NOW,
      }),
      "1h",
    );
    assert.equal(
      defaultChartTimeframe({
        kind: "rwa",
        requested: "1m",
        listedAt: new Date(NOW - 60_000).toISOString(),
        now: NOW,
      }),
      "1h",
    );
  });

  it("lets an explicit ?tf= win over a young listing", () => {
    assert.equal(
      defaultChartTimeframe({
        kind: "token",
        requested: "1D",
        listedAt: new Date(NOW - 60_000).toISOString(),
        now: NOW,
      }),
      "1D",
    );
  });
});

describe("New row chart links", () => {
  it("puts tf=1m on a token chart URL", () => {
    assert.equal(
      assetPath("token", "0xAbc0000000000000000000000000000000000001", "1m"),
      "/token/0xabc0000000000000000000000000000000000001?tf=1m",
    );
  });

  it("leaves trending / search links without a tf query", () => {
    const token = {
      kind: "token",
      id: "0xAbc0000000000000000000000000000000000001",
    } as Asset;
    assert.equal(
      assetHref(token),
      "/token/0xabc0000000000000000000000000000000000001",
    );
  });
});
