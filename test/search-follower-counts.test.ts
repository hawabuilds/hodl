import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

/**
 * Search results show a follower count on every person card.
 *
 * `searchUsers` built its profiles with a bare `toProfile(row)`, whose
 * followers parameter defaults to 0 — so the tab published "0 followers"
 * beside every account regardless of the follow graph. A wrong number reads
 * as a real one; the other list builders in this file all count first.
 */
describe("search follower counts", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/server/social-live.ts"),
    "utf8",
  );

  function bodyOf(name: string): string {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  }

  it("searchUsers counts followers instead of defaulting them to zero", () => {
    const body = bodyOf("searchUsers");
    assert.match(body, /followerCountsFor\(/);
    assert.match(body, /toProfile\(row, counts\.get\(row\.id\) \?\? 0\)/);
    // The bare call is what published the zero.
    assert.doesNotMatch(body, /toProfile\(row as UserRow\)/);
  });

  it("every profile-list builder counts followers", () => {
    for (const name of ["searchUsers", "profilesByHandles", "followerProfilesOfId"]) {
      assert.match(bodyOf(name), /followerCountsFor\(/, name);
    }
  });

  it("toProfile still defaults to zero, so an uncounted list is the bug", () => {
    assert.match(src, /function toProfile\(row: UserRow, followers = 0, following = 0\)/);
  });
});
