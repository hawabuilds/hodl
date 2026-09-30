import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ALERT_PREFS,
  EMPTY_TOASTS,
  alertPrefsFromRow,
  cleanAlertPatch,
  dismissToast,
  followingAlerts,
  groupToastText,
  badgeLabel,
  followingBadgeCount,
  mergeActivity,
  pushToasts,
  tradeUsdLabel,
  unreadBell,
  unreadFollowing,
  type Activity,
  type BellItem,
  type FollowingItem,
} from "../src/lib/alerts";

const person = {id: "u1", handle: "ana", displayName: "Ana", pfpUrl: null};
const asset = {kind: "token" as const, id: "0xabc", symbol: "AI", pairedTicker: "NVDA", imageUrl: null};
const trade = (id: string, side: "buy" | "sell", usd: number | null, at = "2026-09-30T10:00:00Z") =>
  ({type: "trade", id, at, person, side, usd, asset}) as FollowingItem;
const comment = (id: string, at = "2026-09-30T10:00:00Z") =>
  ({type: "comment", id, at, person, body: "gm", asset}) as FollowingItem;
const reply = (id: string, at = "2026-09-30T10:00:00Z") =>
  ({type: "reply", id, at, person, body: "agreed", asset}) as BellItem;
const follow = (id: string, at = "2026-09-30T10:00:00Z") =>
  ({type: "follow", id, at, person}) as BellItem;

describe("alert settings", () => {
  it("reads a switch nobody has touched (null) as on", () => {
    const prefs = alertPrefsFromRow({
      follow_buys: null,
      follow_sells: false,
      follow_comments: true,
      replies: null,
      new_followers: null,
      popups: null,
      min_trade_usd: null,
    });
    assert.equal(prefs.followBuys, true);
    assert.equal(prefs.followSells, false);
    assert.equal(prefs.popups, true);
    assert.equal(prefs.minTradeUsd, 0);
  });

  it("defaults to everything on and every trade when there is no row", () => {
    assert.deepEqual(alertPrefsFromRow(null), DEFAULT_ALERT_PREFS);
  });

  it("keeps only known fields of the right type from a client", () => {
    assert.deepEqual(
      cleanAlertPatch({popups: false, followBuys: "no", minTradeUsd: "250", user_id: "x"}),
      {popups: false, minTradeUsd: 250},
    );
    assert.deepEqual(cleanAlertPatch({minTradeUsd: -5}), {});
  });
});

describe("what alerts", () => {
  it("follows the buy and sell switches separately", () => {
    const prefs = {...DEFAULT_ALERT_PREFS, followSells: false};
    assert.equal(followingAlerts(trade("a", "buy", 10), prefs), true);
    assert.equal(followingAlerts(trade("b", "sell", 10), prefs), false);
  });

  it("drops trades under the threshold, and trades of unknown size once one is set", () => {
    const prefs = {...DEFAULT_ALERT_PREFS, minTradeUsd: 100};
    assert.equal(followingAlerts(trade("a", "buy", 99), prefs), false);
    assert.equal(followingAlerts(trade("b", "buy", 100), prefs), true);
    assert.equal(followingAlerts(trade("c", "buy", null), prefs), false);
    assert.equal(followingAlerts(trade("d", "buy", null), DEFAULT_ALERT_PREFS), true);
  });

  it("counts only what is newer than the seen mark and still switched on", () => {
    const activity: Activity = {
      following: [
        trade("new", "buy", 5, "2026-09-30T10:05:00Z"),
        comment("c", "2026-09-30T10:04:00Z"),
        trade("old", "buy", 5, "2026-09-30T09:00:00Z"),
      ],
      bell: [reply("r", "2026-09-30T10:05:00Z"), follow("f", "2026-09-30T10:06:00Z")],
      followingSeenAt: "2026-09-30T10:00:00Z",
      bellSeenAt: null,
      followingCount: 2,
    };
    assert.equal(unreadFollowing(activity, DEFAULT_ALERT_PREFS), 2);
    assert.equal(unreadFollowing(activity, {...DEFAULT_ALERT_PREFS, followComments: false}), 1);
    assert.equal(unreadBell(activity, DEFAULT_ALERT_PREFS), 2);
    assert.equal(unreadBell(activity, {...DEFAULT_ALERT_PREFS, newFollowers: false}), 1);
  });

  it("merges newest first and caps the list", () => {
    const merged = mergeActivity<FollowingItem>(
      [[trade("t", "buy", 1, "2026-09-30T10:01:00Z")], [comment("c", "2026-09-30T10:02:00Z")]],
      1,
    );
    assert.deepEqual(merged.map((item) => item.id), ["c"]);
  });
});

describe("pop-ups", () => {
  const t0 = 1_000_000;
  const trades = (ids: string[]) => ids.map((id) => ({kind: "trade" as const, item: trade(id, "buy", 500)}));

  it("shows up to three one by one", () => {
    const state = pushToasts(EMPTY_TOASTS, trades(["a", "b", "c"]), t0);
    assert.equal(state.toasts.length, 3);
    assert.ok(state.toasts.every((toast) => !toast.group));
  });

  it("groups more than three inside ten seconds into one", () => {
    let state = pushToasts(EMPTY_TOASTS, trades(["a", "b", "c"]), t0);
    state = pushToasts(state, trades(["d", "e"]), t0 + 4_000);
    assert.equal(state.toasts.length, 1);
    const [group] = state.toasts;
    assert.ok(group?.group);
    assert.equal(group.count, 5);
    assert.equal(groupToastText("trade", group.count), "5 new trades from people you follow");
    assert.equal(group.latest.id, "e");
  });

  it("adds later arrivals to an open group instead of starting new pop-ups", () => {
    let state = pushToasts(EMPTY_TOASTS, trades(["a", "b", "c", "d"]), t0);
    state = pushToasts(state, trades(["e"]), t0 + 2_000);
    assert.equal(state.toasts.length, 1);
    assert.equal(state.toasts[0]?.group && state.toasts[0].count, 5);
  });

  it("does not group arrivals that are more than ten seconds apart", () => {
    let state = pushToasts(EMPTY_TOASTS, trades(["a", "b", "c"]), t0);
    state = dismissToast(state, "trade:a");
    state = pushToasts(state, trades(["d"]), t0 + 11_000);
    assert.equal(state.toasts.length, 3);
    assert.ok(state.toasts.every((toast) => !toast.group));
  });

  it("never keeps more than three on screen, dropping the oldest", () => {
    let state = pushToasts(EMPTY_TOASTS, trades(["a", "b"]), t0);
    state = pushToasts(state, [{kind: "reply", item: reply("r1")}, {kind: "reply", item: reply("r2")}], t0 + 1);
    assert.deepEqual(state.toasts.map((toast) => toast.id), ["trade:b", "reply:r1", "reply:r2"]);
  });

  it("writes sizes the way a pop-up has room for", () => {
    assert.equal(tradeUsdLabel(500), "$500");
    assert.equal(tradeUsdLabel(1_250), "$1.3K");
    assert.equal(tradeUsdLabel(12_400), "$12K");
    assert.equal(tradeUsdLabel(null), null);
  });
});

describe("phone Following tab badge", () => {
  const activity: Activity = {
    following: [trade("a", "buy", 5, "2026-09-30T10:05:00Z"), comment("c", "2026-09-30T10:04:00Z")],
    bell: [reply("r", "2026-09-30T10:05:00Z")],
    followingSeenAt: "2026-09-30T10:00:00Z",
    bellSeenAt: "2026-09-30T10:00:00Z",
    followingCount: 1,
  };

  it("counts both halves of the page, as Settings → Alerts allows", () => {
    assert.equal(followingBadgeCount(activity, DEFAULT_ALERT_PREFS), 3);
    assert.equal(followingBadgeCount(activity, {...DEFAULT_ALERT_PREFS, replies: false}), 2);
    assert.equal(followingBadgeCount(null, DEFAULT_ALERT_PREFS), 0);
  });

  it("reads 9+ past nine, and nothing at all at zero", () => {
    assert.equal(badgeLabel(3), "3");
    assert.equal(badgeLabel(12), "9+");
    assert.equal(badgeLabel(0), null);
  });
});
