import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  digestCopy,
  digestFromItems,
  followCopy,
  holdingsMultipleCopy,
  notifyMoney,
  notifyTicker,
  notifyTokenAmount,
  replyBatchCopy,
  replyCopy,
  replyPreview,
  tradeFailedCopy,
  tradeFilledCopy,
  watchlistMultipleCopy,
} from "../src/lib/notifications/copy";
import {followDedupeKey, isFreshDedupe} from "../src/lib/notifications/dedupe";
import {
  consumeThrough,
  highestMilestone,
  multipleRatio,
} from "../src/lib/notifications/milestones";
import {inQuietHours} from "../src/lib/notifications/quietHours";

describe("notification milestones", () => {
  it("fires 2x once from entry", () => {
    assert.equal(highestMilestone(2, [2, 5, 10], []), 2);
    assert.equal(highestMilestone(2.5, [2, 5, 10], [2]), null);
  });

  it("does not re-fire after a dip back through 2x", () => {
    assert.equal(highestMilestone(1.5, [2, 5, 10], [2]), null);
    assert.equal(highestMilestone(2, [2, 5, 10], [2]), null);
  });

  it("1.8x to 6x sends one 5x and consumes 2x", () => {
    const hit = highestMilestone(6, [2, 5, 10], []);
    assert.equal(hit, 5);
    assert.deepEqual(consumeThrough(5, [2, 5, 10]), [2, 5]);
    assert.equal(highestMilestone(6, [2, 5, 10], [2, 5]), null);
  });

  it("needs a positive reference price", () => {
    assert.equal(multipleRatio(10, 0), null);
    assert.equal(multipleRatio(10, 2), 5);
  });
});

describe("follow dedupe", () => {
  it("is one stable key per pair so unfollow can delete it", () => {
    assert.equal(followDedupeKey("target", "follower"), "follow:target:follower");
  });

  it("treats a row from two hours ago as stale", () => {
    const now = new Date("2026-09-08T16:12:00Z");
    assert.equal(isFreshDedupe("2026-09-08T14:24:28.503Z", now), false);
  });

  it("treats a row from two minutes ago as fresh", () => {
    const now = new Date("2026-09-08T16:12:00Z");
    assert.equal(isFreshDedupe("2026-09-08T16:10:00Z", now), true);
  });
});

describe("notification copy", () => {
  it("formats tickers as $ + uppercase", () => {
    assert.equal(notifyTicker("foo"), "$FOO");
    assert.equal(notifyTicker("$foo"), "$FOO");
  });

  it("formats money without trailing .00", () => {
    assert.equal(notifyMoney(2400), "$2,400");
    assert.equal(notifyMoney(480), "$480");
    assert.equal(notifyMoney(10.5), "$10.50");
  });

  it("abbreviates large token amounts", () => {
    assert.equal(notifyTokenAmount(1_240_000), "1.24M");
  });

  it("writes holdings multiples from cost and value", () => {
    const copy = holdingsMultipleCopy({
      symbol: "FOO",
      milestone: 5,
      costUsd: 480,
      valueUsd: 2400,
    });
    assert.equal(copy.title, "$FOO is up 5x");
    assert.equal(copy.body, "Your $480 position is now $2,400");
  });

  it("writes watchlist multiples from add and mark price", () => {
    const copy = watchlistMultipleCopy({
      symbol: "FOO",
      milestone: 5,
      addPrice: 0.0012,
      currentPrice: 0.0061,
    });
    assert.equal(copy.title, "$FOO is up 5x");
    assert.equal(copy.body, "Since you added it — $0.0012 → $0.0061");
  });

  it("writes a single new follower", () => {
    const copy = followCopy(["alice"]);
    assert.equal(copy.title, "New follower");
    assert.equal(copy.body, "@alice started following you");
  });

  it("batches two followers without others", () => {
    const copy = followCopy(["alice", "bob"]);
    assert.equal(copy.title, "2 new followers");
    assert.equal(copy.body, "@alice, @bob started following you");
  });

  it("batches three-plus followers with a rest count", () => {
    const copy = followCopy(["alice", "bob", "cara", "drew"]);
    assert.equal(copy.title, "4 new followers");
    assert.equal(copy.body, "@alice, @bob and 2 others started following you");
  });

  it("uses reply text as the body and truncates to 80 + ellipsis", () => {
    const copy = replyCopy("alice", "hello\nthere  world");
    assert.equal(copy.title, "@alice replied to you");
    assert.equal(copy.body, "hello there world");
    const long = "x".repeat(90);
    assert.equal(replyPreview(long), `${"x".repeat(80)}…`);
    assert.equal(replyPreview("nice 🔥 take"), "nice 🔥 take");
  });

  it("batches replies with the asset ticker", () => {
    const copy = replyBatchCopy(3, "FOO");
    assert.equal(copy.title, "3 new replies");
    assert.equal(copy.body, "on your comment about $FOO");
  });

  it("writes trade fill and fail copy", () => {
    const buy = tradeFilledCopy({
      side: "buy",
      tokenAmount: 1_240_000,
      ticker: "FOO",
      quoteAmount: 0.05,
      quoteSymbol: "ETH",
    });
    assert.equal(buy.title, "Buy filled");
    assert.equal(buy.body, "1.24M $FOO for 0.05 ETH");
    const sell = tradeFilledCopy({
      side: "sell",
      tokenAmount: 1_240_000,
      ticker: "FOO",
      quoteAmount: 0.05,
      quoteSymbol: "ETH",
    });
    assert.equal(sell.title, "Sell filled");
    assert.equal(sell.body, "1.24M $FOO for 0.05 ETH");
    const fail = tradeFailedCopy("Price moved past your slippage.");
    assert.equal(fail.title, "Trade failed");
    assert.equal(fail.body, "Price moved past your slippage. — nothing was charged");
  });

  it("composes a daily digest and omits zero categories", () => {
    const full = digestCopy(6, {ticker: "FOO", milestone: 5, replies: 3, followers: 2});
    assert.equal(full.title, "6 updates today");
    assert.equal(full.body, "$FOO hit 5x, 3 replies and 2 new followers");
    const noReplies = digestCopy(3, {ticker: "FOO", milestone: 5, replies: 0, followers: 2});
    assert.equal(noReplies.body, "$FOO hit 5x and 2 new followers");
    const onlyFollows = digestCopy(2, {followers: 2});
    assert.equal(onlyFollows.body, "2 new followers");
  });

  it("builds a digest from queued items using the highest multiple", () => {
    const copy = digestFromItems([
      {kind: "multiple", title: "$FOO is up 2x", body: "Your $100 position is now $200", payload: {d: {type: "multiple", ticker: "FOO", n: 2}}},
      {kind: "multiple", title: "$FOO is up 5x", body: "Your $100 position is now $500", payload: {d: {type: "multiple", ticker: "FOO", n: 5}}},
      {kind: "reply", title: "@a replied to you", body: "hi", payload: {d: {type: "reply", n: 1}}},
      {kind: "follow", title: "New follower", body: "@b started following you", payload: {d: {type: "follow", n: 1}}},
    ]);
    assert.equal(copy.title, "4 updates today");
    assert.equal(copy.body, "$FOO hit 5x, 1 reply and 1 new follower");
  });
});

describe("quiet hours", () => {
  it("wraps overnight", () => {
    const now = new Date("2026-09-08T23:30:00Z");
    assert.equal(
      inQuietHours(now, {timezone: "UTC", quietStart: "22:00", quietEnd: "08:00"}),
      true,
    );
    assert.equal(
      inQuietHours(new Date("2026-09-08T12:00:00Z"), {
        timezone: "UTC",
        quietStart: "22:00",
        quietEnd: "08:00",
      }),
      false,
    );
  });
});
