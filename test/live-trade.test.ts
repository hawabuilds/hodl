import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {chainSupportsAtomicBatch} from "../src/hooks/useTradeBatching";
import {liveTraderAllowed} from "../src/lib/liveTrade";

const WALLET = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";

describe("live trade flag", () => {
  it("stays off without flag, router, or allowlist", () => {
    assert.equal(
      liveTraderAllowed(WALLET, {flag: false, router: ROUTER, wallets: [WALLET]}),
      false,
    );
    assert.equal(
      liveTraderAllowed(WALLET, {flag: true, router: "", wallets: [WALLET]}),
      false,
    );
    assert.equal(
      liveTraderAllowed(WALLET, {flag: true, router: ROUTER, wallets: []}),
      false,
    );
    assert.equal(
      liveTraderAllowed(WALLET, {
        flag: true,
        router: ROUTER,
        wallets: ["0x3333333333333333333333333333333333333333"],
      }),
      false,
    );
  });

  it("opens only for an allowlisted wallet when the router is set", () => {
    assert.equal(
      liveTraderAllowed(WALLET, {flag: true, router: ROUTER, wallets: [WALLET]}),
      true,
    );
  });
});

describe("two-signature batching", () => {
  it("collapses to one signature only if 4663 reports atomic support", () => {
    assert.equal(chainSupportsAtomicBatch(null), false);
    assert.equal(chainSupportsAtomicBatch({}), false);
    assert.equal(
      chainSupportsAtomicBatch({"0x1237": {atomic: {status: "unsupported"}}}),
      false,
    );
    assert.equal(
      chainSupportsAtomicBatch({"0x1237": {atomic: {status: "supported"}}}),
      true,
    );
  });
});
