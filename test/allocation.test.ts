import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  OTHER_KEY,
  actualWeights,
  allocationKey,
  cleanTargets,
  drift,
  equalTargets,
  groupSmallSlices,
  normalizeTargets,
  planTopUp,
  pricedHoldings,
  rebalanceScore,
  spendableEthUsd,
  targetsFromActual,
  targetsValid,
} from "../src/lib/allocation";
import type {Holding} from "../src/lib/types";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

function holding(assetId: string, symbol: string, valueUsd: number, kind: "token" | "rwa" = "token"): Holding {
  return {kind, assetId, symbol, name: symbol, logoUrl: null, amount: 1, valueUsd, changePct: 0, costUsd: null};
}

const KA = `token:${A}`;
const KB = `token:${B}`;

describe("allocation weights (ported from Trador)", () => {
  it("leaves unpriced holdings out of the weights", () => {
    const holdings = [holding(A, "AAA", 10), holding(B, "BBB", 0)];
    assert.equal(pricedHoldings(holdings).length, 1);
    const weights = actualWeights(holdings);
    assert.equal(weights.length, 1);
    assert.equal(weights[0].weight, 100);
  });

  it("keys holdings by kind and id", () => {
    assert.equal(allocationKey(holding("nvda", "NVDA", 1, "rwa")), "rwa:nvda");
    assert.equal(allocationKey(holding(A.toUpperCase().replace("0X", "0x"), "AAA", 1)), KA);
  });

  it("scales targets to sum to 100", () => {
    const normalized = normalizeTargets({[KA]: 30, [KB]: 30}, [KA, KB]);
    assert.equal(normalized[KA], 50);
    assert.equal(normalized[KB], 50);
  });

  it("checks a target total", () => {
    assert.equal(targetsValid({a: 50, b: 50}), true);
    assert.equal(targetsValid({a: 40, b: 50}), false);
    assert.equal(targetsValid({}), false);
    assert.equal(targetsValid({a: 120, b: -20}), false);
  });

  it("measures drift from target", () => {
    const rows = drift([holding(A, "AAA", 60), holding(B, "BBB", 40)], {[KA]: 40, [KB]: 60});
    const a = rows.find((row) => row.key === KA)!;
    assert.equal(Math.round(a.deltaPct), 20);
    assert.equal(Math.round(a.deltaUsd), -20);
    assert.equal(Math.round(rebalanceScore(rows)), 20);
  });

  it("seeds equal and current targets that sum to 100", () => {
    const equal = equalTargets([KA, KB, `rwa:nvda`]);
    assert.ok(targetsValid(equal));
    const actual = targetsFromActual([holding(A, "AAA", 30), holding(B, "BBB", 10)]);
    assert.ok(targetsValid(actual));
    assert.ok(actual[KA] > actual[KB]);
  });
});

describe("top up", () => {
  it("spreads new money over the underweight holdings only, by how far under they are", () => {
    const holdings = [holding(A, "AAA", 80), holding(B, "BBB", 10), holding("nvda", "NVDA", 10, "rwa")];
    const legs = planTopUp(holdings, {[KA]: 50, [KB]: 30, "rwa:nvda": 20}, 30);
    // AAA is overweight: never bought. BBB is 20 under, NVDA 10 under.
    assert.deepEqual(legs.map((leg) => leg.key), [KB, "rwa:nvda"]);
    assert.equal(legs[0].amountUsd, 20);
    assert.equal(legs[1].amountUsd, 10);
  });

  it("marks legs under $1 as below the minimum", () => {
    const legs = planTopUp([holding(A, "AAA", 99), holding(B, "BBB", 1)], {[KA]: 98, [KB]: 2}, 0.5);
    assert.ok(legs.every((leg) => leg.belowMinimum));
  });

  it("plans nothing with no money or nothing underweight", () => {
    assert.deepEqual(planTopUp([holding(A, "AAA", 10)], {[KA]: 100}, 50), []);
    assert.deepEqual(planTopUp([holding(A, "AAA", 10), holding(B, "BBB", 10)], {[KA]: 60, [KB]: 40}, 0), []);
  });
});

describe("chart slices", () => {
  it("folds slices under 2% into Other", () => {
    const slices = actualWeights([
      holding(A, "AAA", 970),
      holding(B, "BBB", 15),
      holding("0x" + "c".repeat(40), "CCC", 15),
    ]);
    const grouped = groupSmallSlices(slices);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[1].key, OTHER_KEY);
    assert.equal(grouped[1].grouped?.length, 2);
    assert.ok(Math.abs(grouped[1].weight - 3) < 1e-9);
  });

  it("keeps a single small slice as itself", () => {
    const grouped = groupSmallSlices(actualWeights([holding(A, "AAA", 99), holding(B, "BBB", 1)]));
    assert.deepEqual(grouped.map((slice) => slice.symbol), ["AAA", "BBB"]);
  });
});

describe("saved targets", () => {
  it("accepts known keys and weights", () => {
    assert.deepEqual(cleanTargets({[KA]: 60.123, "rwa:nvda": 39.877}), {[KA]: 60.12, "rwa:nvda": 39.88});
  });

  it("rejects anything else", () => {
    assert.equal(cleanTargets(null), null);
    assert.equal(cleanTargets([1, 2]), null);
    assert.equal(cleanTargets({"token:nope": 50}), null);
    assert.equal(cleanTargets({[KA]: 150}), null);
    assert.equal(cleanTargets({[KA]: "x"}), null);
  });
});

describe("ETH to spend", () => {
  it("keeps gas back for every buy still to send", () => {
    const usd = spendableEthUsd({
      balanceWei: 10n ** 16n, // 0.01 ETH
      gasPriceWei: 10n ** 9n, // 1 gwei
      buys: 3,
      ethUsd: 3000,
      swapGasUnits: 400_000n,
    });
    // 0.01 ETH less 3 × 400k gas × 1 gwei × 1.2 = 0.00856 ETH ≈ $25.68
    assert.equal(usd, 25.68);
  });

  it("is zero when gas would eat it all, or ETH has no price", () => {
    assert.equal(spendableEthUsd({balanceWei: 10n ** 12n, gasPriceWei: 10n ** 9n, buys: 1, ethUsd: 3000, swapGasUnits: 400_000n}), 0);
    assert.equal(spendableEthUsd({balanceWei: 10n ** 18n, gasPriceWei: 1n, buys: 1, ethUsd: 0, swapGasUnits: 400_000n}), 0);
  });
});
