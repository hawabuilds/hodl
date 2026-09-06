import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
  IMAGE_RANK,
  isBrandLogo,
  noteMissingImageAttempt,
  pickBetterImage,
  resetMissingImageAttempts,
  shouldRetryMissingImage,
  usableImageUrl,
} from "../src/lib/server/live/tokenImages";
import {
  CRON_LIVE_TIP,
  WORKER_LIVE_TIP,
  liveTipResolvesImages,
} from "../src/lib/server/live/liveTip";
import {rememberSeenAfterImages} from "../src/lib/server/live/tokenIndexer";
import {
  RECENT_MISSING_IMAGE_LIMIT,
  RECENT_MISSING_IMAGE_MAX_AGE_MS,
  recentMissingImageWindow,
} from "../src/lib/server/live/universeStore";
import {feedImageUrl} from "../src/lib/tokenImage";

describe("token image resolution", () => {
  it("rejects the launchpad brand mark", () => {
    assert.equal(isBrandLogo("/launchpads/pons.jpg"), true);
    assert.equal(isBrandLogo("https://app.example/launchpads/long.svg"), true);
    assert.equal(
      isBrandLogo("ipfs://bafkreie2mo4dzpjslsoj6zskxjefg23v5txztjq64qn4xyb2zq6lxake7e"),
      false,
    );
    assert.equal(usableImageUrl("/launchpads/pons.jpg"), null);
  });

  it("rejects generated svg placeholders", () => {
    assert.equal(
      usableImageUrl("data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E"),
      null,
    );
  });

  it("ranks DexScreener above a launchpad fallback", () => {
    assert.ok(IMAGE_RANK.dexscreener > IMAGE_RANK.pons);
    assert.ok(IMAGE_RANK.pons > IMAGE_RANK.placeholder);
    assert.equal(IMAGE_RANK.pons, IMAGE_RANK.long);
    const launchpad = {url: "https://pad.example/art.png", source: "pons" as const};
    const dex = {url: "https://dex.example/art.png", source: "dexscreener" as const};
    assert.equal(pickBetterImage(undefined, launchpad), launchpad);
    assert.equal(pickBetterImage(launchpad, dex).source, "dexscreener");
    assert.equal(pickBetterImage(dex, launchpad).source, "dexscreener");
  });

  it("resolves launchpad art before Dex so a 429 cannot skip on-chain images", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/server/live/tokenImages.ts"),
      "utf8",
    );
    const resolveAt = src.indexOf("export async function resolveMediaFor");
    const deployAt = src.indexOf("deployMetaFor", resolveAt);
    const persistAt = src.indexOf("opts?.onLaunchpadResolved", resolveAt);
    const dexAt = src.indexOf("pairsForAddresses", resolveAt);
    assert.ok(resolveAt >= 0 && deployAt > resolveAt && persistAt > deployAt && dexAt > persistAt);
    const retryAt = src.indexOf("15_000", resolveAt);
    const missingAt = src.indexOf("!images.has(address)", resolveAt);
    assert.ok(missingAt > persistAt && retryAt > missingAt);
    assert.match(src, /token socials persist failed; images already written/);
    assert.doesNotMatch(
      src.slice(src.indexOf("export async function persistResolvedImages")),
      /if \(isDexRateLimit\(error\)\) throw error/,
    );
  });

  it("retries missing images after a cooldown, not every tick", () => {
    resetMissingImageAttempts();
    const address = "0xabc";
    assert.equal(shouldRetryMissingImage(address), true);
    const now = Date.parse("2026-09-06T08:00:00.000Z");
    noteMissingImageAttempt(address, now);
    assert.equal(shouldRetryMissingImage(address, now + 60_000), false);
    assert.equal(shouldRetryMissingImage(address, now + 10 * 60 * 1000), true);
    const window = recentMissingImageWindow(now);
    assert.equal(window.limit, RECENT_MISSING_IMAGE_LIMIT);
    assert.equal(RECENT_MISSING_IMAGE_LIMIT, 16);
    assert.equal(
      window.listedSince,
      new Date(now - RECENT_MISSING_IMAGE_MAX_AGE_MS).toISOString(),
    );
    const store = readFileSync(
      join(process.cwd(), "src/lib/server/live/universeStore.ts"),
      "utf8",
    );
    const listAt = store.indexOf("export async function listRecentMissingImages");
    const filterAt = store.indexOf("applyUniverseFilter", listAt);
    assert.ok(listAt >= 0 && filterAt > listAt);
    assert.doesNotMatch(store.slice(listAt, filterAt + 80), /\.eq\(\s*["']eligible["']/);
  });

  it("cron skips images; worker resolves insert and recent-null catch-up", () => {
    assert.equal(liveTipResolvesImages(), false);
    assert.equal(liveTipResolvesImages(CRON_LIVE_TIP), false);
    assert.equal(liveTipResolvesImages(WORKER_LIVE_TIP), true);
    assert.equal(rememberSeenAfterImages(false), true);
    assert.equal(rememberSeenAfterImages(true), false);
  });

  it("serves the remote URL when Storage variants are missing", () => {
    assert.equal(
      feedImageUrl({
        image_url: "https://gateway.pinata.cloud/ipfs/QmVw7iQB7eFF5xggs2WDaoopPY3FBzFkFNsVqNrTs2Ki3w",
      }),
      "https://gateway.pinata.cloud/ipfs/QmVw7iQB7eFF5xggs2WDaoopPY3FBzFkFNsVqNrTs2Ki3w",
    );
  });

  it("does not serve w3s.link first — the browser 403s that gateway", () => {
    const cid = "bafkreie2mo4dzpjslsoj6zskxjefg23v5txztjq64qn4xyb2zq6lxake7e";
    assert.equal(
      feedImageUrl({image_url: `https://w3s.link/ipfs/${cid}`}),
      `https://gateway.pinata.cloud/ipfs/${cid}`,
    );
  });
});
