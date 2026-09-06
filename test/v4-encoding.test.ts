import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  encodeV4SwapExactInSingle,
  packActions,
  v4PoolId,
  V4_ACTION_SETTLE,
  V4_ACTION_SETTLE_ALL,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE,
  V4_ACTION_TAKE_ALL,
} from "../src/lib/v4Encoding";

const KEY = {
  currency0: "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const,
  currency1: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const,
  fee: 100,
  tickSpacing: 1,
  hooks: "0x0000000000000000000000000000000000000000" as const,
};

describe("v4 encoding", () => {
  it("packs SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL", () => {
    assert.equal(
      packActions([
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_SETTLE_ALL,
        V4_ACTION_TAKE_ALL,
      ]),
      "0x060c0f",
    );
  });

  it("encodes UR 2.1.1 execute payload with minHopPriceX36", () => {
    const encoded = encodeV4SwapExactInSingle({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 0n,
    });
    assert.equal(encoded.commands, "0x10");
    assert.equal(encoded.actions, "0x060c0f");
    assert.equal(encoded.inputs.length, 1);
    assert.equal(encoded.currencyIn, KEY.currency0);
    assert.equal(encoded.currencyOut, KEY.currency1);
    assert.ok(encoded.inputs[0].length > 200);
  });

  it("ERC20-in uses SETTLE with payerIsUser=false", () => {
    const encoded = encodeV4SwapExactInSingle({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 0n,
      minHopPriceX36: 0n,
      payerIsUser: false,
    });
    assert.equal(
      encoded.actions,
      packActions([
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_SETTLE,
        V4_ACTION_TAKE_ALL,
      ]),
    );
    assert.equal(encoded.actions, "0x060b0f");
  });

  it("keeps the output on the router for a later hop", () => {
    const encoded = encodeV4SwapExactInSingle({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      takeToRouter: true,
    });
    assert.equal(
      encoded.actions,
      packActions([
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_SETTLE_ALL,
        V4_ACTION_TAKE,
      ]),
    );
    assert.equal(encoded.actions, "0x060c0e");
  });

  it("hashes PoolKey the Uniswap way", () => {
    const id = v4PoolId(KEY);
    assert.match(id, /^0x[0-9a-f]{64}$/);
    assert.equal(v4PoolId(KEY), id);
    assert.notEqual(
      v4PoolId({...KEY, fee: 500}),
      id,
    );
  });
});
