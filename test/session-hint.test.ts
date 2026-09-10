import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {isPrivySessionKey} from "../src/lib/session.ts";

/**
 * Decides whether the wallet stack — about a megabyte of Privy and wagmi —
 * has to load before the landing page can paint.
 *
 * Wrong in one direction costs a signed-in visitor their session and bounces
 * them to the landing page. Wrong in the other costs a stranger the full load
 * this is meant to save them.
 */
describe("isPrivySessionKey", () => {
  it("treats stored credentials as a session", () => {
    assert.equal(isPrivySessionKey("privy:token"), true);
    assert.equal(isPrivySessionKey("privy:refresh_token"), true);
  });

  /**
   * Privy writes all three of these the moment it boots, signed in or not —
   * observed on the deployed landing page with an empty session. Counting any
   * of them makes every visit after the first one eager, which is the visitor
   * the deferral exists for. `privy:connections` is the trap: it reads like a
   * session but is written on boot with an empty list.
   */
  it("does not mistake boot-time state for a session", () => {
    assert.equal(isPrivySessionKey("privy:connections"), false);
    assert.equal(isPrivySessionKey("privy:caid"), false);
    assert.equal(
      isPrivySessionKey("privy:sent:cmtjbj2et04ad0cl7jbzt88lu:8046041200143596"),
      false,
    );
  });

  // Privy has renamed storage keys before; anything token-shaped still counts.
  it("still matches a renamed token key", () => {
    assert.equal(isPrivySessionKey("privy:access_token"), true);
    assert.equal(isPrivySessionKey("privy:id_token"), true);
  });

  it("ignores everything outside the namespace", () => {
    assert.equal(isPrivySessionKey("rwa.theme"), false);
    assert.equal(isPrivySessionKey("token"), false);
    assert.equal(isPrivySessionKey(null), false);
    assert.equal(isPrivySessionKey(""), false);
  });
});
