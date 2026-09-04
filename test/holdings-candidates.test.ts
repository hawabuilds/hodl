import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {mergeCandidates} from "../src/lib/server/live/holdings.ts";

describe("portfolio candidates", () => {
  it("unions touched, registry and known holdings without duplicates", () => {
    const touched = ["0xAAA0000000000000000000000000000000000001"];
    const registry = [
      "0xaaa0000000000000000000000000000000000001",
      "0xBBB0000000000000000000000000000000000002",
    ];
    const known = ["0xccc0000000000000000000000000000000000003"];
    assert.deepEqual(mergeCandidates(touched, registry, known), [
      "0xaaa0000000000000000000000000000000000001",
      "0xbbb0000000000000000000000000000000000002",
      "0xccc0000000000000000000000000000000000003",
    ]);
  });

  it("drops junk and does not require a universe row", () => {
    assert.deepEqual(mergeCandidates(["not-an-address", "0x1"], ["0xDDD0000000000000000000000000000000000004"]), [
      "0xddd0000000000000000000000000000000000004",
    ]);
  });
});
