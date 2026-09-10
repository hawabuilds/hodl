import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

/**
 * `#app-overlays` is pointer-events:none so the frame underneath stays
 * clickable through the empty overlay layer. Anything portaled into it must
 * therefore take pointer events back on its own panel.
 *
 * A panel that forgets looks completely correct — it positions, animates and
 * paints — and silently ignores every click inside it. That shipped once, on
 * the followers/following list, where it read as the rows just not being
 * links.
 */
const COMPONENTS = join(process.cwd(), "src/components");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("overlay panels keep their own pointer events", () => {
  const portaled = sourceFiles(COMPONENTS).filter((path) => {
    const src = readFileSync(path, "utf8");
    return (
      src.includes("<OverlayPortal") &&
      !path.endsWith("OverlayPortal.tsx")
    );
  });

  it("finds the portaled panels to check", () => {
    assert.ok(
      portaled.length >= 3,
      `expected to find the overlay panels, found ${portaled.length}`,
    );
  });

  for (const path of portaled) {
    const name = path.split(/[\\/]/).pop();
    it(`${name} re-enables pointer events`, () => {
      const src = readFileSync(path, "utf8");
      assert.match(
        src,
        /pointer-events-auto/,
        `${name} portals into #app-overlays (pointer-events:none) but never ` +
          `sets pointer-events-auto, so every click inside it is swallowed`,
      );
    });
  }
});
