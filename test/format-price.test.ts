import assert from "node:assert/strict";
import test from "node:test";

import {price} from "../src/lib/format.ts";

test("price never uses scientific notation", () => {
  for (const value of [0.000041, 0.00000012, 1.44e-8, 6.2e-12]) {
    const shown = price(value);
    assert.equal(shown.includes("e"), false, shown);
    assert.equal(shown.includes("E"), false, shown);
    assert.match(shown, /^\$0\.0+[1-9]/);
  }
});

test("price keeps leading decimal zeros on low caps", () => {
  assert.equal(price(0.000041), "$0.000041");
  assert.match(price(1.23e-7), /^\$0\.0000001/);
});

test("price still reads as dollars at a dollar and above", () => {
  assert.equal(price(1.5), "$1.50");
  assert.equal(price(0), "$0.00");
  assert.equal(price(Number.NaN), "—");
});
