import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {changeFromViewStart, headerChange, priceDayAgo} from "../src/lib/chartHeader";
import {formatAxisUsd, formatSubscriptUsd, priceMinMove} from "../src/lib/priceFormat";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");
const hourly = (prices: number[], endAt = NOW) =>
  prices.map((price, i) => ({t: endAt - (prices.length - i) * HOUR, price}));

describe("price format", () => {
  it("counts the zeros of a tiny price instead of writing them out", () => {
    assert.equal(formatSubscriptUsd(0.000002583), "$0.0₅2583");
    assert.equal(formatSubscriptUsd(0.00005632), "$0.0₄5632");
  });

  it("keeps ordinary prices as they were", () => {
    assert.equal(formatSubscriptUsd(0.1834), "$0.1834");
    assert.equal(formatSubscriptUsd(0.008812), "$0.008812");
    assert.equal(formatSubscriptUsd(0.0001), "$0.0001000");
    assert.equal(formatSubscriptUsd(682.5), "$682.50");
    assert.equal(formatSubscriptUsd(1196.81), "$1,196.81");
  });

  it("rounds up across a power of ten without a fifth digit", () => {
    assert.equal(formatSubscriptUsd(0.0000099996), "$0.0₄1000");
  });

  it("says unknown rather than zero", () => {
    assert.equal(formatSubscriptUsd(0), "—");
    assert.equal(formatSubscriptUsd(null), "—");
  });

  it("writes axis ticks without trailing zeros", () => {
    assert.equal(formatAxisUsd(0.25, 1e-4), "$0.25");
    assert.equal(formatAxisUsd(0.00005, 1e-8), "$0.0₄5");
    assert.equal(formatAxisUsd(0.0002, 1e-7), "$0.0002");
  });

  it("prints floating-point noise on the zero tick as $0", () => {
    assert.equal(formatAxisUsd(2.8e-17, 1e-4), "$0");
  });

  it("steps the axis as finely as the smallest price", () => {
    assert.equal(priceMinMove([0.1834, 0.35]), 0.0001);
    assert.ok(Math.abs(priceMinMove([0.000002583]) - 1e-9) < 1e-20);
    assert.equal(priceMinMove([682.5]), 0.01);
    assert.equal(priceMinMove([]), 0.01);
  });
});

describe("change beside the price", () => {
  const asset = {kind: "token" as const, priceUsd: 0.2, changePct: 25, listedAt: "2026-07-20T09:00:00Z"};

  it("is the live price against the close 24 hours ago, labelled 24h", () => {
    // 30 hourly bars; the one that ended 24h ago closed at 0.1.
    const bars = hourly(Array.from({length: 30}, (_, i) => (i === 5 ? 0.1 : 0.15)));
    const change = headerChange({asset, livePrice: 0.12, hourly: bars, now: NOW});
    assert.equal(change.label, "24h");
    assert.ok(Math.abs((change.pct ?? 0) - 20) < 1e-9);
  });

  it("does not depend on the timeframe on screen, only on hourly bars", () => {
    const bars = hourly(Array.from({length: 30}, () => 0.1));
    const a = headerChange({asset, livePrice: 0.11, hourly: bars, now: NOW, launchPrice: 0.001});
    const b = headerChange({asset, livePrice: 0.11, hourly: bars, now: NOW});
    assert.deepEqual(a, b);
  });

  it("uses the last trade before the cutoff when nothing traded since", () => {
    const bars = [{t: NOW - 10 * 24 * HOUR, price: 0.05}];
    assert.equal(priceDayAgo(bars, NOW), 0.05);
  });

  it("falls back to the market's 24h change when the bars start too late", () => {
    const change = headerChange({asset, livePrice: 0.2, hourly: hourly([0.19, 0.2]), now: NOW});
    assert.equal(change.label, "24h");
    // 0.2 is +25% on 0.16.
    assert.ok(Math.abs((change.pct ?? 0) - 25) < 1e-9);
  });

  it("is since launch for a token younger than a day", () => {
    const listedAt = new Date(NOW - 5 * HOUR).toISOString();
    const bars = [{t: NOW - 5 * HOUR, price: 0.02, open: 0.01}, {t: NOW - 4 * HOUR, price: 0.03}];
    const change = headerChange({asset: {...asset, listedAt}, livePrice: 0.04, hourly: bars, now: NOW});
    assert.equal(change.label, "since launch");
    assert.ok(Math.abs((change.pct ?? 0) - 300) < 1e-9);
  });

  it("measures the hover from the first bar in view", () => {
    assert.ok(Math.abs((changeFromViewStart(0.15, 0.2) ?? 0) + 25) < 1e-9);
    assert.equal(changeFromViewStart(0.15, null), null);
  });
});
