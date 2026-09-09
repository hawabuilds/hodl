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
  liveTipResolvesImages,
  paceCaughtUpSubscribe,
  pollIntervalMs,
  redactSecrets,
  rowsWritten,
} from "../src/lib/server/live/liveTip";
import {
  ALCHEMY_GETLOGS_MAX,
  CATCHUP_LOG_WINDOW,
  LIVE_TIP_LOG_WINDOW,
  LogScanLimiter,
  cursorAfterLogScan,
  getLogsStartWindow,
  liveScanMaxBlocks,
  nextUnscannedFrom,
  rateLimitBackoffMs,
  resumeIfPersisted,
  shouldSkipRateLimitedRange,
  shrinkLogWindow,
  shouldUseAlchemyForLogs,
} from "../src/lib/server/live/logScan";
import {rememberSeenAfterImages} from "../src/lib/server/live/tokenIndexer";
import {
  WORKER_POOL_MAX,
  isPoolerCheckoutTimeout,
  isTransactionPoolerPort,
} from "../src/lib/server/live/adminPg";
import {
  HEALTHY_HOLDER_LOG_EVERY,
  LIVE_TIP_LOCK_APP_NAME,
  LIVE_TIP_LOCK_CLASS,
  LIVE_TIP_LOCK_ID,
  LOCK_FRESH_MS,
  LOCK_STALE_MS,
  decideLockWait,
  formatLockWaitDetails,
  heartbeatAgeFromSql,
  heartbeatAgeMs,
  holderLooksAbandoned,
  isSafeToTerminateHolder,
  lockSessionApplicationName,
  lockWaitBackoffMs,
  lockWaitDecision,
  looksLikeLiveTipLockSession,
  looksLikeRandomAppQuery,
  shouldLogLockWait,
} from "../src/lib/server/live/workerLock";

describe("live tip shared pass", () => {
  it("cron keeps the 45s budget; worker does not", () => {
    assert.equal(CRON_LIVE_TIP.live, true);
    assert.equal(CRON_LIVE_TIP.historical, false);
    assert.equal(CRON_LIVE_TIP.drainGap, false);
    assert.equal(CRON_LIVE_TIP.budgetMs, 45_000);
    assert.equal(CRON_LIVE_TIP.writeCap, 8);
    assert.equal(CRON_LIVE_TIP.skipImages, true);
    assert.equal(WORKER_LIVE_TIP.skipImages, false);
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
    assert.match(src, /another live worker is indexing; this replica will stay idle/);
    assert.match(src, /pg_terminate_backend/);
    assert.match(src, /inspectLockWait/);
    assert.match(src, /tryStealStaleLock/);
    assert.match(src, /touchHeartbeat/);
    assert.match(src, /withWorkClient\(pool/);
    assert.match(src, /never unlock from this session/);
    assert.match(src, /formatLockWaitDetails/);
    assert.match(src, /paceCaughtUpSubscribe/);
    assert.match(src, /extract\(epoch from \(now\(\) - last_run_at\)\)/);
    assert.match(src, /probeFailed = true/);
    assert.doesNotMatch(src, /heartbeat probe failed[\s\S]{0,120}return "wait"/);
  });

  it("vercel.json does not schedule token indexing (Railway worker owns it)", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: {path: string}[];
    };
    const paths = vercel.crons.map((row) => row.path);
    assert.ok(!paths.includes("/api/cron/index-tokens"));
  });

  it("cron skips images; worker resolves insert and recent-null catch-up", () => {
    assert.equal(liveTipResolvesImages(), false);
    assert.equal(liveTipResolvesImages(CRON_LIVE_TIP), false);
    assert.equal(liveTipResolvesImages(WORKER_LIVE_TIP), true);
    const tip = readFileSync(join(process.cwd(), "src/lib/server/live/liveTip.ts"), "utf8");
    assert.match(tip, /persistRecentMissingImages/);
    assert.match(tip, /liveTipResolvesImages/);
  });

  it("a persist throw does not mark the token seen", () => {
    assert.equal(rememberSeenAfterImages(false), true);
    assert.equal(rememberSeenAfterImages(true), false);
    const indexer = readFileSync(
      join(process.cwd(), "src/lib/server/live/tokenIndexer.ts"),
      "utf8",
    );
    const persistAt = indexer.indexOf("await persistResolvedImages");
    const seenAt = indexer.indexOf("rememberSeenAfterImages");
    assert.ok(persistAt >= 0 && seenAt > persistAt);
    assert.match(indexer, /token image persist failed; tokens still upserted/);
    assert.match(indexer, /from "\.\/logScan"/);
    assert.match(indexer, /alchemyLogsClient/);
    assert.match(indexer, /shouldUseAlchemyForLogs/);
    assert.match(indexer, /cursorAfterLogScan/);
    assert.match(indexer, /resumeIfPersisted/);
    assert.match(indexer, /logScanBackingOff/);
    assert.match(indexer, /chainstackLogsClient/);
    assert.match(indexer, /retrying on \$\{usingProvider\}/);
    assert.doesNotMatch(indexer, /public RPC rate-limited repeatedly/);
    const headAt = indexer.indexOf("async function head(");
    const headBody = indexer.slice(headAt, indexer.indexOf("interface LaunchLog"));
    assert.match(headBody, /logsClient\.getBlockNumber/);
    assert.doesNotMatch(headBody, /alchemyLogsClient/);
    assert.doesNotMatch(headBody, /ALCHEMY_RPC_URL/);
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

describe("live tip lock steal helpers", () => {
  const now = Date.parse("2026-09-06T08:00:00.000Z");

  it("treats missing and invalid heartbeats as unknown age", () => {
    assert.equal(heartbeatAgeMs(null, now), null);
    assert.equal(heartbeatAgeMs(undefined, now), null);
    assert.equal(heartbeatAgeMs("", now), null);
    assert.equal(heartbeatAgeMs("not-a-date", now), null);
    assert.equal(LIVE_TIP_LOCK_CLASS, 4663);
    assert.equal(LIVE_TIP_LOCK_ID, 1);
    assert.equal(LIVE_TIP_LOCK_APP_NAME, "rwa-live-tip");
  });

  it("clamps future timestamps and parses Date or ISO strings", () => {
    assert.equal(heartbeatAgeMs(new Date(now + 5_000), now), 0);
    assert.equal(heartbeatAgeMs(new Date(now - 12_000), now), 12_000);
    assert.equal(heartbeatAgeMs("2026-09-06T07:59:40.000Z", now), 20_000);
  });

  it("steals when heartbeat is missing or older than two minutes", () => {
    assert.equal(lockWaitDecision(null), "steal");
    assert.equal(lockWaitDecision(LOCK_STALE_MS), "steal");
    assert.equal(lockWaitDecision(LOCK_STALE_MS + 1), "steal");
  });

  it("keeps waiting on a fresh holder and does not steal the in-between band", () => {
    assert.equal(LOCK_FRESH_MS, 30_000);
    assert.equal(LOCK_STALE_MS, 120_000);
    assert.equal(lockWaitDecision(0), "healthy");
    assert.equal(lockWaitDecision(LOCK_FRESH_MS - 1), "healthy");
    assert.equal(lockWaitDecision(LOCK_FRESH_MS), "wait");
    assert.equal(lockWaitDecision(LOCK_STALE_MS - 1), "wait");
  });

  it("only terminates idle lock sessions, never our pid or active app queries", () => {
    assert.equal(
      isSafeToTerminateHolder({
        pid: 10,
        state: "idle",
        application_name: "rwa-live-tip",
        query: "select pg_try_advisory_lock($1, $2)",
      }),
      true,
    );
    assert.equal(
      isSafeToTerminateHolder({
        pid: 11,
        state: "idle in transaction",
        application_name: "",
        query: "SELECT pg_try_advisory_lock($1, $2)",
      }),
      true,
    );
    assert.equal(
      isSafeToTerminateHolder(
        {
          pid: 12,
          state: "idle",
          application_name: "rwa-live-tip",
          query: "select pg_try_advisory_lock($1, $2)",
        },
        12,
      ),
      false,
    );
    assert.equal(
      isSafeToTerminateHolder({
        pid: 13,
        state: "active",
        application_name: "rwa-live-tip",
        query: "select pg_try_advisory_lock($1, $2)",
      }),
      false,
    );
    assert.equal(
      isSafeToTerminateHolder({
        pid: 14,
        state: "idle",
        application_name: "postgrest",
        query: "select * from tokens where address = $1",
      }),
      true,
    );
    assert.equal(
      isSafeToTerminateHolder({
        pid: 15,
        state: "idle",
        application_name: "",
        query: "",
      }),
      true,
    );
    assert.equal(
      isSafeToTerminateHolder({
        pid: 16,
        state: null,
        application_name: null,
        query: null,
      }),
      true,
    );
  });

  it("classifies lock-session queries vs random app SQL", () => {
    assert.equal(looksLikeLiveTipLockSession("rwa-live-tip", ""), true);
    assert.equal(looksLikeLiveTipLockSession("", "select pg_advisory_unlock($1, $2)"), true);
    assert.equal(looksLikeRandomAppQuery("INSERT INTO tokens VALUES ($1)"), true);
    assert.equal(looksLikeRandomAppQuery("select pg_backend_pid()"), false);
  });

  it("logs healthy-holder waits on the first attempt and every sixth", () => {
    assert.equal(shouldLogLockWait(1), true);
    assert.equal(shouldLogLockWait(HEALTHY_HOLDER_LOG_EVERY), true);
    assert.equal(shouldLogLockWait(2), false);
    assert.equal(shouldLogLockWait(7), false);
    assert.equal(lockWaitBackoffMs(1), 5_000);
    assert.equal(lockWaitBackoffMs(4), 30_000);
    assert.equal(lockWaitBackoffMs(9), 30_000);
  });

  it("parses SQL heartbeat ages and treats missing as steal", () => {
    assert.equal(heartbeatAgeFromSql(null), null);
    assert.equal(heartbeatAgeFromSql(""), null);
    assert.equal(heartbeatAgeFromSql("12000"), 12_000);
    assert.equal(heartbeatAgeFromSql(-5), 0);
    assert.equal(lockWaitDecision(heartbeatAgeFromSql(null)), "steal");
  });

  it("steals when the heartbeat probe fails or the holder is abandoned", () => {
    const liveTip = {
      pid: 21,
      state: "idle",
      application_name: "rwa-live-tip worker abc",
      query: "",
    };
    const leaked = {
      pid: 22,
      state: "idle",
      application_name: "postgrest",
      query: "select * from tokens where address = $1",
    };
    const hidden = {pid: 23, state: null, application_name: null, query: null};
    assert.equal(decideLockWait({ageMs: 1_000, probeFailed: true, holders: [liveTip]}), "steal");
    assert.equal(decideLockWait({ageMs: 1_000, holders: [leaked]}), "steal");
    assert.equal(decideLockWait({ageMs: 1_000, holders: [liveTip]}), "healthy");
    assert.equal(decideLockWait({ageMs: 1_000, holders: [hidden]}), "healthy");
    assert.equal(decideLockWait({ageMs: 1_000, holders: []}), "wait");
    assert.equal(decideLockWait({ageMs: null, holders: [hidden]}), "steal");
    assert.equal(holderLooksAbandoned(leaked), true);
    assert.equal(holderLooksAbandoned(liveTip), false);
    assert.equal(holderLooksAbandoned(hidden), false);
  });

  it("logs heartbeat age, holder pid, app name, and probe state", () => {
    const details = formatLockWaitDetails({
      ageMs: 1_500,
      probeFailed: false,
      holders: [
        {
          pid: 44,
          state: "idle",
          application_name: "rwa-live-tip worker-1 r1",
          query: "",
        },
      ],
    });
    assert.match(details, /heartbeatAge=1500ms/);
    assert.match(details, /holderPid=44/);
    assert.match(details, /state=idle/);
    assert.match(details, /app=rwa-live-tip worker-1 r1/);
    assert.match(details, /probeFailed=no/);
    assert.equal(
      lockSessionApplicationName({RAILWAY_SERVICE_NAME: "live-worker", RAILWAY_REPLICA_ID: "rep-9"}, 7),
      "rwa-live-tip live-worker rep-9",
    );
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
    assert.equal(paceCaughtUpSubscribe(0, true), true);
    assert.equal(paceCaughtUpSubscribe(80, true), false);
    assert.equal(paceCaughtUpSubscribe(0, false), false);
  });

  it("live getLogs windows stay small at tip and 429 backoff grows", () => {
    assert.equal(liveScanMaxBlocks(0), LIVE_TIP_LOG_WINDOW);
    assert.equal(liveScanMaxBlocks(10n), LIVE_TIP_LOG_WINDOW);
    assert.ok(liveScanMaxBlocks(0) < 200n);
    assert.equal(liveScanMaxBlocks(500), 1_000n);
    assert.equal(
      getLogsStartWindow({caughtUp: true, alchemy: false, live: true, span: 900n}),
      LIVE_TIP_LOG_WINDOW,
    );
    assert.equal(
      getLogsStartWindow({caughtUp: true, alchemy: true, live: true, span: 900n}),
      ALCHEMY_GETLOGS_MAX,
    );
    assert.equal(
      getLogsStartWindow({caughtUp: false, alchemy: false, live: true, span: 900n}),
      CATCHUP_LOG_WINDOW,
    );
    assert.equal(
      getLogsStartWindow({caughtUp: false, alchemy: true, live: true, span: 900n}),
      ALCHEMY_GETLOGS_MAX,
    );
    assert.equal(shouldUseAlchemyForLogs({hasAlchemy: true, caughtUp: true, span: 40n}), true);
    assert.equal(shouldUseAlchemyForLogs({hasAlchemy: true, caughtUp: false, span: 900n}), true);
    assert.equal(shouldUseAlchemyForLogs({hasAlchemy: false, caughtUp: true, span: 40n}), false);
    assert.equal(shouldUseAlchemyForLogs({hasAlchemy: false, caughtUp: false, span: 900n}), false);
    assert.equal(
      cursorAfterLogScan({stored: 100n, plannedEnd: 200n, scannedTo: null, complete: false}),
      100n,
    );
    assert.equal(
      cursorAfterLogScan({stored: 100n, plannedEnd: 200n, scannedTo: 140n, complete: false}),
      140n,
    );
    assert.equal(
      cursorAfterLogScan({stored: 100n, plannedEnd: 200n, scannedTo: 200n, complete: true}),
      200n,
    );
    assert.equal(resumeIfPersisted(1_000n, 100n, 100n), 100n);
    assert.equal(resumeIfPersisted(120n, 100n, 100n), 116n);
    assert.equal(rateLimitBackoffMs(0), 4_000);
    assert.equal(rateLimitBackoffMs(1), 8_000);
    assert.equal(rateLimitBackoffMs(2), 16_000);
    assert.ok(rateLimitBackoffMs(6) > rateLimitBackoffMs(0));
    assert.equal(rateLimitBackoffMs(8), 60_000);
    assert.equal(shrinkLogWindow(128n), 64n);
    assert.equal(nextUnscannedFrom(100n, 70n), 96n);
    assert.equal(nextUnscannedFrom(5_000_000n, 1_000n), 1_000n);

    const limiter = new LogScanLimiter();
    const wait = limiter.note429(10n, 200n, 1_000);
    assert.equal(wait, 4_000);
    assert.equal(shouldSkipRateLimitedRange(limiter.last, 20n, 80n, 2_000), true);
    assert.equal(shouldSkipRateLimitedRange(limiter.last, 20n, 80n, 6_000), false);
    const later = limiter.note429(10n, 200n, 6_000);
    assert.equal(later, 8_000);
    limiter.noteOk("0xfactory:TokenLaunched", 200n);
    assert.equal(limiter.strikes, 1);
    assert.equal(limiter.resumeFrom("0xfactory:TokenLaunched", 170n), 196n);
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
