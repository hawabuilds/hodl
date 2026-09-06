import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
  CRON_LIVE_TIP,
  LIVE_TIP_HEARTBEAT,
  WORKER_LIVE_TIP,
  applyPassCursors,
  backoffMs,
  blocksBehindTip,
  blocksProcessed,
  formatUnknownError,
  pollIntervalMs,
  redactSecrets,
  rowsWritten,
} from "../src/lib/server/live/liveTip";
import {
  WORKER_POOL_MAX,
  isPoolerCheckoutTimeout,
  isTransactionPoolerPort,
} from "../src/lib/server/live/adminPg";

describe("live tip shared pass", () => {
  it("cron keeps the 45s budget; worker does not", () => {
    assert.equal(CRON_LIVE_TIP.live, true);
    assert.equal(CRON_LIVE_TIP.historical, false);
    assert.equal(CRON_LIVE_TIP.drainGap, false);
    assert.equal(CRON_LIVE_TIP.budgetMs, 45_000);
    assert.equal(CRON_LIVE_TIP.writeCap, 8);
    assert.equal(WORKER_LIVE_TIP.budgetMs, 0);
    assert.equal(WORKER_LIVE_TIP.writeCap, 8);
    assert.equal(WORKER_LIVE_TIP.writeConcurrency, 1);
    assert.equal(WORKER_LIVE_TIP.batchPauseMs, 400);
    assert.equal(CRON_LIVE_TIP.writeConcurrency, 1);
  });

  it("cron route calls the extracted pass", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/index-tokens/route.ts"),
      "utf8",
    );
    assert.match(src, /indexLiveTipPass/);
    assert.doesNotMatch(src, /indexTokens\(/);
  });

  it("worker uses one Pool max 5 and never uncapped writes", () => {
    const src = readFileSync(join(process.cwd(), "src/worker/index.ts"), "utf8");
    assert.match(src, /createAdminPool/);
    assert.match(src, /WORKER_POOL_MAX/);
    assert.match(src, /pg_advisory_unlock/);
    assert.match(src, /releaseWorkerPg/);
    assert.doesNotMatch(src, /new pg\.Client/);
    assert.doesNotMatch(src, /writeCap:\s*undefined/);
    assert.doesNotMatch(src, /Promise\.all\(/);
    assert.doesNotMatch(src, /another worker holds the advisory lock; exiting/);
    assert.match(src, /advisory lock held by another session; waiting/);
  });

  it("vercel.json does not schedule token indexing (Railway worker owns it)", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: {path: string}[];
    };
    const paths = vercel.crons.map((row) => row.path);
    assert.ok(!paths.includes("/api/cron/index-tokens"));
  });
});

describe("live tip cursors and logs", () => {
  it("advances held cursors from passes and never goes backwards", () => {
    const held = new Map<string, bigint>([["tokens:pons-v2:live", 100n]]);
    applyPassCursors(held, [
      {factory: "pons-v2:live", from: "70", to: "140", cursorTo: "140", upserts: 2, unresolvedRewards: []},
      {factory: "pons-v2:live", from: "140", to: "150", cursorTo: "90", upserts: 0, unresolvedRewards: []},
    ]);
    assert.equal(held.get("tokens:pons-v2:live"), 140n);
  });

  it("counts blocks processed and rows written", () => {
    const passes = [
      {factory: "pons-v2:live", from: "10", to: "20", cursorTo: "20", upserts: 3, unresolvedRewards: []},
      {factory: "long-airlock:live", from: "5", to: "5", cursorTo: "5", upserts: 1, unresolvedRewards: []},
    ];
    assert.equal(blocksProcessed(passes), 10);
    assert.equal(rowsWritten(passes), 4);
  });

  it("blocks behind uses the furthest-behind live cursor", () => {
    const held = new Map<string, bigint>([
      ["tokens:pons-v2:live", 90n],
      ["tokens:long-airlock:live", 80n],
      ["tokens:pons-v2:live-gap", 10n],
    ]);
    assert.equal(blocksBehindTip(100n, held), 20);
    assert.equal(LIVE_TIP_HEARTBEAT, "live-tip");
  });
});

describe("live tip backoff and errors", () => {
  it("backoff grows and stays capped", () => {
    const first = backoffMs(0, 400, 30_000);
    const later = backoffMs(8, 400, 30_000);
    assert.ok(first >= 400 && first <= 520);
    assert.ok(later <= 30_000);
    assert.ok(later >= first);
  });

  it("polls at block time and uses a subscribe safety net", () => {
    assert.equal(pollIntervalMs(0, true), 2_000);
    assert.equal(pollIntervalMs(300, false), 50);
    assert.equal(pollIntervalMs(0, false), 250);
  });

  it("recognizes a session-pooler checkout timeout", () => {
    const error = new Error(
      "(ECHECKOUTTIMEOUT) unable to check out connection from the pool after 15000ms in Session mode",
    ) as Error & {code: string};
    error.code = "XX000";
    assert.equal(isPoolerCheckoutTimeout(error), true);
    assert.equal(isTransactionPoolerPort(6543), true);
    assert.equal(isTransactionPoolerPort(5432), false);
    assert.equal(WORKER_POOL_MAX, 5);
  });

  it("logs cause and status without leaking URLs", () => {
    const cause = new Error("upstream https://robinhood-mainnet.g.alchemy.com/v2/secret");
    const error = new Error("getLogs failed") as Error & {status: number; cause: Error};
    error.status = 429;
    error.cause = cause;
    const formatted = formatUnknownError(error);
    assert.equal(formatted.status, 429);
    assert.ok(formatted.cause);
    assert.equal((formatted.cause as {message?: string}).message?.includes("[redacted]"), true);
    assert.equal(redactSecrets("https://example.com/x alch_abc123"), "[redacted] [redacted]");
  });
});
