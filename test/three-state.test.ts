import assert from "node:assert/strict";
import test from "node:test";

import {showsThreeState} from "../src/lib/threeState.ts";

test("null and true show; only false hides", () => {
  assert.equal(showsThreeState(true), true);
  assert.equal(showsThreeState(null), true);
  assert.equal(showsThreeState(undefined), true);
  assert.equal(showsThreeState(false), false);
});
