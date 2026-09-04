import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  looksInvertedMemecoin,
  reorientPoints,
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

  it("rescales an inverted series onto the live token price", () => {
    const out = reorientPoints(
      [
        {t: 1, price: 140},
        {t: 2, price: 149},
      ],
      0.0097,
      80_000,
    );
    assert.equal(out.length, 2);
    assert.ok(Math.abs(out[1].price - 0.0097) < 1e-9);
    assert.ok(out[0].price < 0.02);
  });

  it("hides an inverted series when there is no live price", () => {
    assert.deepEqual(
      reorientPoints([{t: 1, price: 149}, {t: 2, price: 150}], null, 80_000),
      [],
    );
  });
});
