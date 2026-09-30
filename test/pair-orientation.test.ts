import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  applyOrientation,
  decideOrientation,
  looksInvertedMemecoin,
  orientAgainstTrade,
  usdPriceFor,
} from "../src/lib/pairOrientation";

describe("pair orientation", () => {
  it("keeps the base token's USD price", () => {
    assert.equal(
      usdPriceFor(
        {
          base: "0xaaa",
          quote: "0xbbb",
          priceUsd: "0.01",
          priceNative: "2",
        },
        "0xaaa",
      ),
      0.01,
    );
  });

  it("uses quotePriceUsd when the token is quote", () => {
    assert.equal(
      usdPriceFor(
        {
          base: "0xspcx",
          quote: "0xhood",
          priceUsd: "149",
          quotePriceUsd: "0.006741",
        },
        "0xhood",
      ),
      0.006741,
    );
  });

  it("inverts through priceNative when the token is quote", () => {
    // 1 SPCX = $149 = 15360 SPACEHOOD → SPACEHOOD ≈ $0.0097
    const price = usdPriceFor(
      {
        base: "0xspcx",
        quote: "0xhood",
        priceUsd: "149",
        priceNative: "15360.8247",
      },
      "0xhood",
    );
    assert.ok(price);
    assert.ok(Math.abs(price - 149 / 15360.8247) < 1e-9);
  });

  it("flags a memecoin printed at equity scale", () => {
    assert.equal(looksInvertedMemecoin(149, 80_000), true);
    assert.equal(looksInvertedMemecoin(0.0097, 80_000), false);
    assert.equal(looksInvertedMemecoin(149, 5_000_000), false);
  });

  it("keeps candles that agree with the pool's latest on-chain trade", () => {
    const candles = [
      {t: 1, price: 0.0000028},
      {t: 2, price: 0.0000026},
    ];
    const out = orientAgainstTrade(candles, 0.0000025829, 3_400);
    assert.equal(out.orientation, "kept");
    assert.deepEqual(out.points, candles);
  });

  it("flips candles quoted the other way round, checked against the trade", () => {
    // Candles in tokens per dollar: 1 / $0.0000025 = 400,000.
    const out = orientAgainstTrade(
      [
        {t: 1, price: 500_000, open: 450_000, high: 520_000, low: 440_000},
        {t: 2, price: 400_000},
      ],
      0.0000025,
      3_400,
    );
    assert.equal(out.orientation, "flipped");
    assert.ok(Math.abs(out.points[1]!.price - 0.0000025) < 1e-15);
    // A flipped candle's high comes from its low.
    assert.ok(Math.abs(out.points[0]!.high! - 1 / 440_000) < 1e-15);
    assert.ok(Math.abs(out.points[0]!.low! - 1 / 520_000) < 1e-15);
  });

  it("hides candles that match the trade neither way, rather than rescaling them", () => {
    // The stock's side of the pool: $149 against a token trading at $0.0097.
    const out = orientAgainstTrade([{t: 1, price: 140}, {t: 2, price: 149}], 0.0097, 80_000);
    assert.equal(out.orientation, "hidden");
    assert.deepEqual(out.points, []);
  });

  it("never takes a provider price: there is no argument for one", () => {
    // The only reference is the pool's trade; a 22x-off stored price cannot reach it.
    assert.equal(orientAgainstTrade.length, 4);
    assert.equal(decideOrientation([{t: 1, price: 0.0000026}], 0.0000026, 3_400), "kept");
  });

  it("hides a memecoin at equity scale when there is no trade to check", () => {
    assert.equal(decideOrientation([{t: 1, price: 149}, {t: 2, price: 150}], null, 80_000), "hidden");
    assert.equal(decideOrientation([{t: 1, price: 0.002}], null, 80_000), "kept");
  });

  it("gives older pages the newest page's decision, whatever their prices", () => {
    // Launch at $0.000001, now $0.1: the old page is history, not inverted.
    const older = [{t: 1, price: 0.000001}];
    assert.deepEqual(applyOrientation(older, "kept"), older);
  });
});
