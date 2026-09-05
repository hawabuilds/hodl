import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  aggregatePayouts,
  interpolateOccurredAt,
  mergeRewardTargets,
  MIN_RECIPIENTS,
  rewardTotalWrites,
  MAX_TOKEN_WRITES,
  roundRewardUsd,
  senderQualifies,
  showsRewards24h,
  totalsByToken,
  type QualifiedSender,
} from "../src/lib/server/live/rewards";

const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";

function sender(over: Partial<QualifiedSender> & {tx?: string; value?: bigint}): QualifiedSender {
  const tx = over.tx ?? "0xtx1";
  const value = over.value ?? 10n ** 18n;
  return {
    sender: over.sender ?? "0xdistributor",
    communityToken: over.communityToken ?? "0xcommunity",
    rows:
      over.rows ??
      Array.from({length: 12}, (_, i) => ({
        token: NVDA,
        to: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        value,
        tx,
        block: 100n + BigInt(i),
      })),
  };
}

describe("reward payout amounts", () => {
  it("requires ten distinct recipients and skips pools", () => {
    assert.equal(senderQualifies(MIN_RECIPIENTS, false), true);
    assert.equal(senderQualifies(MIN_RECIPIENTS - 1, false), false);
    assert.equal(senderQualifies(50, true), false);
  });

  it("aggregates one payout transaction instead of keeping the first hop", () => {
    const quotes = new Map([["NVDA", {priceUsd: 100}]]);
    const rows = aggregatePayouts(
      [sender({tx: "0xabc", value: 2n * 10n ** 18n})],
      quotes,
      () => "2026-09-05T00:00:00.000Z",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.tx_hash, "0xabc");
    assert.equal(rows[0]!.amount, 24);
    assert.equal(rows[0]!.amount_usd, 2400);
    assert.equal(rows[0]!.rwa_ticker, "NVDA");
  });

  it("times a mid-range block from the scanned endpoints", () => {
    const at = interpolateOccurredAt(
      150n,
      100n,
      200n,
      Date.parse("2026-09-05T00:00:00Z"),
      Date.parse("2026-09-05T01:00:00Z"),
    );
    assert.equal(at, "2026-09-05T00:30:00.000Z");
  });

  it("sums 24h USD and leaves unpriced payers out of the total", () => {
    const {totals, unpriced} = totalsByToken(
      [
        {token_address: "0xAAA", rwa_ticker: "NVDA", amount: 2, amount_usd: 200},
        {token_address: "0xaaa", rwa_ticker: "NVDA", amount: 1, amount_usd: 0},
        {token_address: "0xbbb", rwa_ticker: "AAPL", amount: 3, amount_usd: 0},
      ],
      new Map([["NVDA", 100]]),
    );
    assert.equal(roundRewardUsd(totals.get("0xaaa") ?? 0), 300);
    assert.equal(totals.has("0xbbb"), false);
    assert.ok(unpriced.has("0xbbb"));
    assert.equal(unpriced.has("0xaaa"), false);
  });

  it("zeros expired windows but keeps unpriced current totals", () => {
    const desired = new Map([["0xaaa", 50]]);
    const current = new Map([
      ["0xaaa", 10],
      ["0xbbb", 20],
      ["0xccc", 8],
    ]);
    const next = mergeRewardTargets(desired, current, new Set(["0xccc"]));
    assert.equal(next.get("0xaaa"), 50);
    assert.equal(next.get("0xbbb"), 0);
    assert.equal(next.has("0xccc"), false);
  });

  it("writes only changed totals, largest first, under the cap", () => {
    const desired = new Map([
      ["0xaaa", 100],
      ["0xbbb", 5],
      ["0xccc", 0],
    ]);
    const current = new Map([
      ["0xaaa", 10],
      ["0xccc", 40],
    ]);
    const writes = rewardTotalWrites(desired, current, 2);
    assert.equal(MAX_TOKEN_WRITES, 24);
    assert.equal(writes.length, 2);
    assert.deepEqual(
      writes.map((row) => row.address),
      ["0xaaa", "0xccc"],
    );
    assert.equal(writes[0]!.rewards_24h_usd, 100);
    assert.equal(writes[1]!.rewards_24h_usd, 0);
  });

  it("Home Rewards and New ?rewards=rwa need a positive 24h amount", () => {
    assert.equal(showsRewards24h(12.5), true);
    assert.equal(showsRewards24h(0), false);
    assert.equal(showsRewards24h(null), false);
  });
});
