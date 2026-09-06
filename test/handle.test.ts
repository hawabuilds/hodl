import assert from "node:assert/strict";
import test from "node:test";

import {fallbackHandle, handleIlike, normalizeHandle} from "../src/lib/handle.ts";

test("normalizeHandle strips @ and spaces", () => {
  assert.equal(normalizeHandle(" @Hawa "), "Hawa");
});

test("handleIlike is case-preserving exact match without wildcards", () => {
  assert.equal(handleIlike("@Hawa"), "Hawa");
  assert.equal(handleIlike("100%cool"), "100\\%cool");
});

test("fallbackHandle uses handle, then last 8 of id", () => {
  assert.equal(fallbackHandle({handle: "hawa", id: "did:privy:abcdefghijklmnop"}), "hawa");
  assert.equal(fallbackHandle({handle: null, id: "did:privy:abcdefghijklmnop"}), "ijklmnop");
  assert.equal(fallbackHandle(null), null);
});
