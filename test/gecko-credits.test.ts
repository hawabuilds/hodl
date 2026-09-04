import {describe, it, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {
  applyKeyUsage,
  creditRatio,
  geckoUsageSnapshot,
  recordGeckoCall,
  resetGeckoCreditsForTests,
  shouldFallbackToFree,
  shouldWarnCredits,
} from "../src/lib/server/live/geckoCredits";

describe("gecko credits", () => {
  beforeEach(() => {
    resetGeckoCreditsForTests();
  });

  it("falls back to the free host on auth and rate-limit statuses", () => {
    assert.equal(shouldFallbackToFree(429), true);
    assert.equal(shouldFallbackToFree(401), true);
    assert.equal(shouldFallbackToFree(403), true);
    assert.equal(shouldFallbackToFree(200), false);
    assert.equal(shouldFallbackToFree(500), false);
  });

  it("warns at 20% remaining and not above", () => {
    assert.equal(shouldWarnCredits(200, 1000), true);
    assert.equal(shouldWarnCredits(201, 1000), false);
    assert.equal(shouldWarnCredits(0, 500_000), true);
    assert.equal(shouldWarnCredits(100, 0), false);
  });

  it("counts pro vs free by caller", () => {
    recordGeckoCall("chart", "pro");
    recordGeckoCall("chart", "pro");
    recordGeckoCall("tape", "free");
    recordGeckoCall("sweep", "free");
    const snap = geckoUsageSnapshot();
    assert.equal(snap.pro.chart, 2);
    assert.equal(snap.pro.tape, 0);
    assert.equal(snap.free.tape, 1);
    assert.equal(snap.free.sweep, 1);
    assert.equal(creditRatio(800, 1000), 0.8);
  });

  it("applies /key usage and flags the 20% warn once", () => {
    const first = applyKeyUsage({
      monthly_call_credit: 1000,
      current_remaining_monthly_calls: 150,
    });
    assert.equal(first.warned, true);
    assert.equal(first.remaining, 150);
    const second = applyKeyUsage({
      monthly_call_credit: 1000,
      current_remaining_monthly_calls: 140,
    });
    assert.equal(second.warned, true);
    const recovered = applyKeyUsage({
      monthly_call_credit: 1_000_000,
      current_remaining_monthly_calls: 900_000,
    });
    assert.equal(recovered.warned, false);
  });
});
