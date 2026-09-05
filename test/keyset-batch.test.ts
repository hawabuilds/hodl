import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {BATCH_PAGE_DEFAULT, batchPageSize} from "../src/lib/server/live/keysetBatch.ts";

describe("keyset batch page size", () => {
  it("defaults to 500 and clamps to 200–2000", () => {
    assert.equal(batchPageSize(undefined), BATCH_PAGE_DEFAULT);
    assert.equal(batchPageSize("500"), 500);
    assert.equal(batchPageSize("50"), 200);
    assert.equal(batchPageSize("9000"), 2000);
    assert.equal(batchPageSize("not-a-number"), BATCH_PAGE_DEFAULT);
  });
});
