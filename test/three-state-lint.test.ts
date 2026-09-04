import assert from "node:assert/strict";
import test from "node:test";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative} from "node:path";

/**
 * Fails if anyone filters eligible / is_tradeable as a two-state boolean.
 * Allowed: `IS DISTINCT FROM false`, `.or("col.is.null,col.is.true")`,
 * JS `!== false` / `showsThreeState`, and writes that set the flag.
 */
const ROOTS = ["src", "scripts", "test"];
const SKIP = new Set(["test/three-state-lint.test.ts"]);

const FORBIDDEN: {name: string; re: RegExp}[] = [
  {name: '.eq("eligible"', re: /\.eq\(\s*["']eligible["']/},
  {name: '.eq("is_tradeable"', re: /\.eq\(\s*["']is_tradeable["']/},
  {name: "eligible.eq.true", re: /eligible\.eq\.true/},
  {name: "is_tradeable.eq.true", re: /is_tradeable\.eq\.true/},
  {name: "AND eligible", re: /AND eligible(?!\s+IS DISTINCT FROM)/},
  {name: "AND is_tradeable", re: /AND is_tradeable(?!\s+IS DISTINCT FROM)/},
  {name: '.not("last_mcap", "is", null)', re: /\.not\(\s*["']last_mcap["']\s*,\s*["']is["']\s*,\s*["']null["']/},
  {name: "last_mcap.not.is.null", re: /last_mcap\.not\.is\.null/},
  {name: "last_mcap IS NOT NULL alone", re: /last_mcap\s+IS\s+NOT\s+NULL/i},
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(path, out);
      continue;
    }
    if (/\.(ts|tsx|sql|mjs|js)$/.test(name)) out.push(path);
  }
}

test("no two-state .eq / AND filters on eligible or is_tradeable", () => {
  const files: string[] = [];
  for (const root of ROOTS) walk(root, files);
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(".", file).replaceAll("\\", "/");
    if (SKIP.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const rule of FORBIDDEN) {
      if (rule.re.test(text)) hits.push(`${rel}: ${rule.name}`);
    }
  }
  assert.deepEqual(hits, []);
});
