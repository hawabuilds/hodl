import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_RANK,
  isBrandLogo,
  usableImageUrl,
} from "../src/lib/server/live/tokenImages";
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
  });

  it("serves the remote URL when Storage variants are missing", () => {
    assert.equal(
      feedImageUrl({
        image_url: "https://gateway.pinata.cloud/ipfs/QmVw7iQB7eFF5xggs2WDaoopPY3FBzFkFNsVqNrTs2Ki3w",
      }),
      "https://gateway.pinata.cloud/ipfs/QmVw7iQB7eFF5xggs2WDaoopPY3FBzFkFNsVqNrTs2Ki3w",
    );
  });
});
