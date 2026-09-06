import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" || name === ".next" || name === "out" || name === "cache" || name === "lib"
    ) {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|mjs|sol|md)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe("paper fill and fee floor are gone", () => {
  it("has no applyFill, $0.95, or $9.50 in app sources", () => {
    const roots = ["src", "test", "contracts", "scripts"].map((d) =>
      join(process.cwd(), d),
    );
    const banned = new RegExp(["applyFill", "FEE_MIN_USD", "0" + ".95", "9" + ".50"].join("|"));
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (file.endsWith("hodl-paper-gone.test.ts")) continue;
        const text = readFileSync(file, "utf8");
        if (banned.test(text)) hits.push(file.replace(process.cwd() + "\\", ""));
      }
    }
    assert.deepEqual(hits, [], `banned paper-fill / floor strings:\n${hits.join("\n")}`);
  });
});
