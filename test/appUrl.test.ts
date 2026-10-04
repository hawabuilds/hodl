import {describe, it, afterEach} from "node:test";
import assert from "node:assert/strict";
import {appOrigin} from "../src/config/appUrl.ts";

describe("appOrigin", () => {
  const saved = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  };

  afterEach(() => {
    if (saved.NEXT_PUBLIC_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved.NEXT_PUBLIC_APP_URL;
    if (saved.VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = saved.VERCEL_URL;
  });

  it("prefers NEXT_PUBLIC_APP_URL and strips trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hodl.fan/";
    delete process.env.VERCEL_URL;
    assert.equal(appOrigin(), "https://hodl.fan");
  });

  it("falls back to APP_DOMAIN when env is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    assert.equal(appOrigin(), "https://hodl.fan");
  });

  it("uses VERCEL_URL when explicit origin is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "hodl-git-preview.vercel.app";
    assert.equal(appOrigin(), "https://hodl-git-preview.vercel.app");
  });
});
