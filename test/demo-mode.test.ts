import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {DATA_UNAVAILABLE, DEMO_MODE} from "../src/lib/server/demoMode";

describe("demo mode", () => {
  it("is off unless DEMO_MODE=1, so a missing database never serves seeded people", () => {
    assert.equal(process.env.DEMO_MODE === "1", DEMO_MODE);
    if (process.env.DEMO_MODE == null) assert.equal(DEMO_MODE, false);
    assert.match(DATA_UNAVAILABLE, /data unavailable/i);
  });
});
