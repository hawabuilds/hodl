import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  needsPriceAttempt,
  showsOnNew,
  REQUIRE_MEASURED_MCAP_ON_NEW,
} from "../src/lib/priceState";
import {PRICE_LIST_COLUMNS, CRON_PRICE_PAGE} from "../src/lib/server/live/universeStore";
import {batchPageSize, runKeysetBatch, type BatchCursor} from "../src/lib/server/live/keysetBatch";

describe("price cron list", () => {
  it("selects slim columns, never star or image blobs", () => {
    assert.equal(PRICE_LIST_COLUMNS.includes("*"), false);
    assert.equal(PRICE_LIST_COLUMNS.includes("image"), false);
    assert.ok(PRICE_LIST_COLUMNS.includes("address"));
    assert.ok(PRICE_LIST_COLUMNS.includes("total_supply"));
    assert.ok(CRON_PRICE_PAGE <= 80);
  });

  it("skips priced and evaluated no_pool/failed", () => {
    assert.equal(needsPriceAttempt(null), true);
    assert.equal(needsPriceAttempt({priced_at: null, price_status: null}), true);
    assert.equal(needsPriceAttempt({priced_at: "2026-09-05T00:00:00Z", price_status: "priced"}), false);
    assert.equal(needsPriceAttempt({priced_at: null, price_status: "no_pool"}), false);
    assert.equal(needsPriceAttempt({priced_at: null, price_status: "failed"}), false);
  });

  it("New hides no_pool/failed and requires measured mcap", () => {
    assert.equal(REQUIRE_MEASURED_MCAP_ON_NEW, true);
    assert.equal(showsOnNew({price_status: "no_pool"}), false);
    assert.equal(showsOnNew({price_status: "failed"}), false);
    assert.equal(showsOnNew({priced_at: null, last_mcap: null}), false);
    assert.equal(
      showsOnNew({priced_at: "2026-09-05T00:00:00Z", last_mcap: 12_000, price_status: "priced"}),
      true,
    );
  });
});

describe("runKeysetBatch page failure", () => {
  it("advances the cursor when a page throws", async () => {
    const store: {cursor: BatchCursor} = {cursor: {lastKey: null, scanned: 0}};
    const pages = [
      [{address: "0xaaa"}, {address: "0xbbb"}],
      [{address: "0xccc"}],
    ];
    let loads = 0;
    const result = await runKeysetBatch({
      name: "test:prices",
      pageSize: 2,
      continueOnPageError: true,
      readCursor: async () => store.cursor,
      writeCursor: async (_name, lastKey, scanned) => {
        store.cursor = {lastKey, scanned};
      },
      loadPage: async () => pages[loads++] ?? [],
      keyOf: (row) => row.address,
      onPage: async (page) => {
        if (page[0]?.address === "0xaaa") throw new Error("rpc flake");
        return {priced: page.length};
      },
    });
    assert.equal(result.extra.pageFailed, 1);
    assert.equal(result.extra.priced, 1);
    assert.equal(store.cursor.lastKey, "0xccc");
    assert.equal(store.cursor.scanned, 3);
  });

  it("clamps batch page size", () => {
    assert.equal(batchPageSize("50"), 200);
    assert.equal(batchPageSize("500"), 500);
  });
});
