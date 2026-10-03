import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  MIN_TICK,
  depthWords,
  initializedTicks,
  quoteDepthRaw,
} from "../src/lib/server/live/poolDepth";

const Q96 = 2n ** 96n;
const L = 10n ** 18n;
const sqrtX96At = (tick: number) => BigInt(Math.round(Math.pow(1.0001, tick / 2) * 2 ** 48)) * 2n ** 48n;

describe("pool quote depth", () => {
  // Token is currency0, quote currency1: a launch curve's liquidity sits above
  // the price (token side), from tick 0 to tick 1000.
  const curve = new Map<number, bigint>([[0, L], [1000, -L]]);

  it("reads 0 for a launch curve nobody has bought from, where virtual reserves read L", () => {
    const pool = {sqrtPriceX96: Q96, tick: 0, liquidity: L, tickSpacing: 8, quoteIsCurrency1: true};
    const virtualQuote = Number(L); // L·√P with √P = 1
    assert.equal(quoteDepthRaw(pool, [0], curve), 0);
    assert.ok(virtualQuote > 0);
  });

  it("counts exactly the quote buyers paid in once the price has moved up the curve", () => {
    const pool = {sqrtPriceX96: sqrtX96At(400), tick: 400, liquidity: L, tickSpacing: 8, quoteIsCurrency1: true};
    const expected = Number(L) * (Math.pow(1.0001, 200) - 1);
    const got = quoteDepthRaw(pool, [0], curve);
    assert.ok(Math.abs(got - expected) / expected < 1e-6, `${got} vs ${expected}`);
  });

  it("mirrors for a quote that is currency0 (selling the token pushes the price up)", () => {
    // Token is currency1: the curve sits below the price, from -1000 to 0.
    const mirrored = new Map<number, bigint>([[-1000, L], [0, -L]]);
    const empty = {sqrtPriceX96: Q96, tick: -1, liquidity: L, tickSpacing: 8, quoteIsCurrency1: false};
    assert.ok(quoteDepthRaw(empty, [0], mirrored) < Number(L) * 1e-4);
    const traded = {sqrtPriceX96: sqrtX96At(-400), tick: -400, liquidity: L, tickSpacing: 8, quoteIsCurrency1: false};
    const expected = Number(L) * (1 / Math.pow(1.0001, -200) - 1);
    const got = quoteDepthRaw(traded, [0], mirrored);
    assert.ok(Math.abs(got - expected) / expected < 1e-6, `${got} vs ${expected}`);
  });

  it("matches virtual reserves for liquidity with no tick in reach (a traded pool reads as before)", () => {
    const pool = {sqrtPriceX96: Q96, tick: 0, liquidity: L, tickSpacing: 8, quoteIsCurrency1: true};
    const expected = Number(L) * (1 - Math.pow(1.0001, MIN_TICK / 2));
    const got = quoteDepthRaw(pool, [], new Map());
    assert.ok(Math.abs(got - expected) / expected < 1e-9);
    assert.ok(Math.abs(got / Number(L) - 1) < 1e-9); // L·√P, the virtual quote
  });

  it("reads the two bitmap words nearest the price, on the quote side, nearest tick first", () => {
    assert.deepEqual(depthWords({tick: 0, tickSpacing: 8, quoteIsCurrency1: true}), [0, -1]);
    assert.deepEqual(depthWords({tick: -9, tickSpacing: 8, quoteIsCurrency1: false}), [-1, 0]);
    const bits = new Map<number, bigint>([[0, (1n << 0n) | (1n << 125n)], [-1, 1n << 255n]]);
    // compressed 0 → tick 0; compressed -1 → tick -8; compressed 125 → tick 1000 (above, skipped).
    assert.deepEqual(initializedTicks({tick: 3, tickSpacing: 8, quoteIsCurrency1: true}, bits), [0, -8]);
  });
});
