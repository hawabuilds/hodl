import assert from "node:assert/strict";
import test from "node:test";

import {
  asAddress,
  isAddress,
  normalizeAddress,
  normalizeAddresses,
  sameAddress,
} from "../src/lib/address.ts";

const checksum = "0x385F4f8ae47651ce5F58F5265395a669f8281e18";
const stored = "0x385f4f8ae47651ce5f58f5265395a669f8281e18";

test("checksummed input normalises to the lowercase store key", () => {
  assert.equal(normalizeAddress(checksum), stored);
  assert.equal(normalizeAddress(`  ${checksum}  `), stored);
  assert.deepEqual(normalizeAddresses([checksum, stored]), [stored, stored]);
});

test("sameAddress matches checksummed input to a lowercase row", () => {
  assert.equal(sameAddress(checksum, stored), true);
  assert.equal(isAddress(checksum), true);
  assert.equal(isAddress(stored), true);
  assert.equal(asAddress(checksum), stored);
  assert.equal(asAddress("MEME"), null);
});

test("a checksummed lookup key equals the stored lowercase row", async () => {
  const {hasDatabase} = await import("../src/lib/server/db.ts");
  const {getTokenRow} = await import("../src/lib/server/live/universeStore.ts");
  if (!hasDatabase) {
    assert.equal(normalizeAddress(checksum), stored);
    return;
  }
  const row = await getTokenRow(checksum);
  assert.ok(row, "checksummed address must find the lowercase row");
  assert.equal(row.address, stored);
  assert.equal(row.symbol, "MEME");
});
