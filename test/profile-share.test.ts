import {describe, it, afterEach} from "node:test";
import assert from "node:assert/strict";
import {profilePath, profileShareUrl} from "../src/lib/routes.ts";

describe("profileShareUrl", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
  });

  it("joins app origin with /u/[handle]", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hodl.fan";
    assert.equal(profilePath("alice"), "/u/alice");
    assert.equal(profileShareUrl("alice"), "https://hodl.fan/u/alice");
  });

  it("strips a leading @ from the handle", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hodl.fan/";
    assert.equal(profileShareUrl("@bob"), "https://hodl.fan/u/bob");
  });
});
