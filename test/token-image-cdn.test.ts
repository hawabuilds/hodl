import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  feedImageUrl,
  hexColor,
  ipfsGatewayCandidates,
  ipfsPath,
  isStoredImage,
  placeholderFromAddress,
  tokenImageCandidates,
  usableRemoteImage,
} from "../src/lib/tokenImage";

const STORAGE =
  "https://xyz.supabase.co/storage/v1/object/public/token-images/0xabc/128.webp";
const STORAGE_64 =
  "https://xyz.supabase.co/storage/v1/object/public/token-images/0xabc/64.webp";
const DEX = "https://dd.dexscreener.com/ds-data/tokens/robinhood/0xabc.png";

describe("stored token images", () => {
  it("accepts only the token-images Storage path as stored", () => {
    assert.equal(isStoredImage(STORAGE), true);
    assert.equal(isStoredImage(STORAGE_64), true);
    assert.equal(isStoredImage(DEX), false);
    assert.equal(isStoredImage("ipfs://bafybeig"), false);
    assert.equal(isStoredImage("https://arweave.net/abc"), false);
    assert.equal(isStoredImage("https://gateway.pinata.cloud/ipfs/QmAbc"), false);
  });

  it("prefers stored WebP, then falls back to the remote URL", () => {
    assert.equal(
      feedImageUrl({
        image_url: DEX,
        image_64: null,
        image_128: null,
      }),
      DEX,
    );
    assert.equal(
      feedImageUrl({
        image_url: DEX,
        image_128: STORAGE,
        image_64: STORAGE_64,
      }),
      STORAGE_64,
    );
    assert.deepEqual(
      tokenImageCandidates({
        image_url: DEX,
        image_64: STORAGE_64,
        image_128: STORAGE,
      }),
      [STORAGE_64, STORAGE, DEX],
    );
    assert.equal(usableRemoteImage("/launchpads/pons.jpg"), null);
  });

  it("generates a placeholder from the address", () => {
    const mark = placeholderFromAddress("0xabc");
    assert.match(mark, /^data:image\/svg\+xml/);
    assert.equal(
      placeholderFromAddress("0xabc"),
      placeholderFromAddress("0xABC"),
    );
  });

  it("accepts a six-digit hex average colour", () => {
    assert.equal(hexColor("#1a2b3c"), "#1a2b3c");
    assert.equal(hexColor("1a2b3c"), null);
    assert.equal(hexColor("#fff"), null);
    assert.equal(hexColor(null), null);
  });

  it("rewrites w3s.link / ipfs URLs to gateways the browser can paint", () => {
    const cid = "QmVw7iQB7eFF5xggs2WDaoopPY3FBzFkFNsVqNrTs2Ki3w";
    const pinata = `https://gateway.pinata.cloud/ipfs/${cid}`;
    const cloudflare = `https://cloudflare-ipfs.com/ipfs/${cid}`;
    const w3s = `https://w3s.link/ipfs/${cid}`;
    const ipfsIo = `https://ipfs.io/ipfs/${cid}`;
    assert.equal(ipfsPath(w3s), cid);
    assert.equal(ipfsPath(`ipfs://${cid}`), cid);
    assert.equal(ipfsPath(`https://${cid}.ipfs.w3s.link`), cid);
    assert.deepEqual(ipfsGatewayCandidates(w3s), [pinata, cloudflare, w3s, ipfsIo]);
    assert.equal(feedImageUrl({image_url: w3s}), pinata);
    assert.equal(feedImageUrl({image_url: `ipfs://${cid}`}), pinata);
    assert.deepEqual(tokenImageCandidates({image_url: w3s}), [
      pinata,
      cloudflare,
      w3s,
      ipfsIo,
    ]);
    assert.deepEqual(
      tokenImageCandidates({
        image_url: w3s,
        image_64: STORAGE_64,
        image_128: STORAGE,
      }),
      [STORAGE_64, STORAGE, pinata, cloudflare, w3s, ipfsIo],
    );
    assert.equal(feedImageUrl({image_url: DEX}), DEX);
  });
});
