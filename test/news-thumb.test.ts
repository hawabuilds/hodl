import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {hashUrl, newsThumbPath, newsThumbUrl} from "../src/lib/newsThumb";

describe("news thumbnails", () => {
  it("hashes with 64-bit FNV-1a", () => {
    // Published FNV-1a 64 test vectors.
    assert.equal(hashUrl(""), "cbf29ce484222325");
    assert.equal(hashUrl("a"), "af63dc4c8601ec8c");
    assert.equal(hashUrl("foobar"), "85944171f73967e8");
  });

  it("puts each width of a picture at a path derived from its URL", () => {
    const url = "https://s.yimg.com/example/photo.jpg";
    assert.equal(newsThumbPath(url, 240), `news/${hashUrl(url)}/240.webp`);
    assert.notEqual(newsThumbPath(url, 240), newsThumbPath(`${url}?v=2`, 240));
  });

  it("has no stored copy for anything but a web image URL", () => {
    assert.equal(newsThumbUrl(null, 240), null);
    assert.equal(newsThumbUrl("", 720), null);
    assert.equal(newsThumbUrl("data:image/png;base64,AAAA", 240), null);
  });
});
