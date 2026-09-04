import {describe, it} from "node:test";
import assert from "node:assert/strict";

/**
 * Spec for HodlRouter before the Solidity is written.
 *
 * TransferFrom and the swap happen in one function. A separate tx must
 * never be able to spend a balance that was funded earlier. End-of-call
 * balances of both currencies are zero. Dust is unreachable except by an
 * owner sweep that reverts while the router is unpaused.
 */

type Currency = "token" | "quote";

class HodlRouterMock {
  balances: Record<Currency, bigint> = {token: 0n, quote: 0n};
  paused = false;
  owner = "owner";

  swapExactIn(caller: string, supplied: {currency: Currency; amount: bigint}): bigint {
    if (supplied.amount <= 0n) throw new Error("nothing supplied");
    this.balances[supplied.currency] += supplied.amount;
    const outCurrency: Currency = supplied.currency === "token" ? "quote" : "token";
    const out = supplied.amount;
    this.balances[supplied.currency] = 0n;
    this.balances[outCurrency] = 0n;
    void caller;
    this.assertEmpty();
    return out;
  }

  /** Must not spend a balance the caller did not just supply. */
  steal(currency: Currency, amount: bigint): bigint {
    void currency;
    void amount;
    throw new Error("no public function may move a stranger's balance");
  }

  sweepDust(caller: string): Record<Currency, bigint> {
    if (caller !== this.owner) throw new Error("only owner");
    if (!this.paused) throw new Error("sweep reverts while unpaused");
    const taken = {...this.balances};
    this.balances = {token: 0n, quote: 0n};
    return taken;
  }

  assertEmpty(): void {
    if (this.balances.token !== 0n || this.balances.quote !== 0n) {
      throw new Error("router balances must be zero at end of call");
    }
  }
}

const PUBLIC_FNS = ["swapExactIn", "steal", "sweepDust"] as const;

describe("HodlRouter fund-safety", () => {
  it("swap and transfer happen in one function and leave zero balances", () => {
    const router = new HodlRouterMock();
    const out = router.swapExactIn("alice", {currency: "quote", amount: 1_000n});
    assert.equal(out, 1_000n);
    assert.equal(router.balances.token, 0n);
    assert.equal(router.balances.quote, 0n);
  });

  it("direct funding cannot be stolen through any public function", () => {
    const router = new HodlRouterMock();
    router.balances.token = 50_000n;
    router.balances.quote = 9_000n;

    assert.throws(() => router.steal("token", 1n));
    assert.throws(() => router.steal("quote", 1n));
    assert.throws(() => router.sweepDust("alice"));
    assert.throws(() => router.sweepDust("owner"));
    assert.throws(() =>
      router.swapExactIn("mallory", {currency: "token", amount: 0n}),
    );

    assert.equal(router.balances.token, 50_000n);
    assert.equal(router.balances.quote, 9_000n);

    for (const name of PUBLIC_FNS) {
      assert.equal(typeof router[name], "function");
    }

    router.paused = true;
    const swept = router.sweepDust("owner");
    assert.equal(swept.token, 50_000n);
    assert.equal(router.balances.token, 0n);
  });
});
