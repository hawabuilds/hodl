import {describe, it} from "node:test";
import assert from "node:assert/strict";
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
