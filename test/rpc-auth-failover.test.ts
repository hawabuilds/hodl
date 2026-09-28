import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {isRpcAuthError, isRpcRateLimitError} from "../src/lib/server/live/rpcProviders";

/**
 * A revoked Alchemy key froze the token feed for four days.
 *
 * `eth_getLogs` came back HTTP 401 with the body `Must be authenticated!`.
 * viem wraps that as `InvalidRequestRpcError`, whose text matched none of the
 * log scanner's retry rules — not the 429 rule, not the Cloudflare rule, not
 * the "window too large" rule. So the scan halved its window against the same
 * dead endpoint until it hit the floor and returned `complete: false`, which
 * leaves the cursor exactly where it was. Chainstack and the public RPC were
 * next in the provider list and never got asked.
 */
const ALCHEMY_401 = `InvalidRequestRpcError: JSON is not a valid request object.

URL: https://robinhood-mainnet.g.alchemy.com/v2/alch_redacted
Request body: {"method":"eth_getLogs","params":[{"address":"0x7ed5","fromBlock":"0x4686330","toBlock":"0x4686394"}]}

Details: Must be authenticated!
Version: viem@2.56.0`;

describe("rpc auth failover", () => {
  it("classifies the revoked-key error that stalled the feed", () => {
    assert.equal(isRpcAuthError(ALCHEMY_401), true);
    // It is not a rate limit, so the 429 backoff must not claim it.
    assert.equal(isRpcRateLimitError(ALCHEMY_401), false);
  });

  it("classifies the other ways a key dies", () => {
    for (const text of [
      "HTTP 401 Unauthorized",
      "Must be authenticated!",
      "invalid api key",
      "authentication failed",
      "api key is required",
    ]) {
      assert.equal(isRpcAuthError(text), true, text);
    }
  });

  it("leaves ordinary scan errors alone", () => {
    for (const text of [
      "query returned more than 10000 results",
      "block range exceeds limit",
      "429 Too Many Requests",
      "Just a moment... cf-mitigated",
      "timed out after 30000ms",
    ]) {
      assert.equal(isRpcAuthError(text), false, text);
    }
  });

  it("403 stays with the Cloudflare branch, which retries the same provider", () => {
    assert.equal(isRpcAuthError("403 Forbidden"), false);
  });

  it("the log scan fails over on auth errors and never dead-ends on one provider", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/server/live/tokenIndexer.ts"),
      "utf8",
    );
    // Auth errors reach the same failover branch as rate limits.
    assert.match(src, /isRpcAuthError\(text\)/);
    // One helper owns the switch, so both branches advance identically.
    assert.match(src, /const advanceProvider = \(\): boolean =>/);
    // The catch-all tries the next provider before reporting the pass
    // incomplete — the line that was missing when the feed stalled.
    const tail = src.slice(src.indexOf("const capped ="));
    const giveUp = tail.indexOf("return {logs: out, scannedTo, complete: false}");
    const failover = tail.indexOf("advanceProvider()");
    assert.ok(failover >= 0 && failover < giveUp, "must try the next provider before giving up");
  });
});
