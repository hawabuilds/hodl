/**
 * Capture palette comparison screenshots via Playwright + system Edge.
 * Run: node scripts/_capture-palette-screens.mjs
 *
 * Requires dev server at http://localhost:3000 (npm run dev).
 */
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "screenshots", "palette-compare");
const baseUrl = process.env.PALETTE_BASE_URL ?? "http://localhost:3000";

const shots = [
  {file: "VersionA-feed.png", path: "/dev/palette-screens/feed?palette=legacy"},
  {file: "VersionB-feed.png", path: "/dev/palette-screens/feed?palette=terminal"},
  {file: "VersionA-token.png", path: "/dev/palette-screens/token?palette=legacy"},
  {file: "VersionB-token.png", path: "/dev/palette-screens/token?palette=terminal"},
];

async function main() {
  await mkdir(outDir, {recursive: true});

  let chromium;
  try {
    ({chromium} = await import("playwright-core"));
  } catch {
    console.error("Install playwright-core: npm install --no-save playwright-core");
    process.exit(1);
  }

  const browser = await chromium.launch({channel: "msedge", headless: true});
  const context = await browser.newContext({
    viewport: {width: 430, height: 860},
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  for (const shot of shots) {
    const page = await context.newPage();
    const url = `${baseUrl}${shot.path}`;
    await page.goto(url, {waitUntil: "networkidle", timeout: 90_000});
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(outDir, shot.file),
      fullPage: false,
    });
    console.log(`Wrote ${shot.file}`);
    await page.close();
  }

  await browser.close();

  await writeFile(
    path.join(outDir, "README.txt"),
    [
      "Palette comparison screenshots",
      "",
      "Version A (legacy): ?palette=legacy — #161A40 page background",
      "Version B (terminal): default — #0D0F18 page, #161A40 cards",
      "",
      "Toggle locally: append ?palette=legacy or ?palette=terminal to any URL.",
      "Persists in localStorage key rwa.palette.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
