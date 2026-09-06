/**
 * Always-on live-tip indexer. Railway runs exactly one replica.
 *
 * One `pg.Pool` (max 5): one checkout holds the advisory lock for the
 * process lifetime; every other query checks out, runs the batch, and
 * releases. Token pages stay sequential with a writeCap. SIGTERM unlocks
 * and `pool.end()` so sessions cannot leak.
 *
 * Shares `indexLiveTipPass` with the Vercel cron. Turn that cron off once
 * this process is keeping pace — two indexers racing is worse than one stall.
 */
import pg from "pg";
import {hasDatabase} from "@/lib/server/db";
import {rpc} from "@/lib/server/live/chain";
import {
  WORKER_POOL_MAX,
  createAdminPool,
  describeAdminPgTarget,
  ipv6UnreachableError,
  isPoolerCheckoutTimeout,
  isTransactionPoolerPort,
  parseAdminDatabaseUrl,
  passwordRejectedError,
  poolerCheckoutTimeoutError,
} from "@/lib/server/live/adminPg";
import {
  LIVE_TIP_HEARTBEAT,
  WORKER_LIVE_TIP,
  applyPassCursors,
  backoffMs,
  blocksBehindTip,
  blocksProcessed,
  emptyLiveCursors,
  formatUnknownError,
  indexLiveTipPass,
  paceCaughtUpSubscribe,
  pollIntervalMs,
  redactSecrets,
  rowsWritten,
} from "@/lib/server/live/liveTip";
import {waitForRpcBudget} from "@/lib/server/live/rpcMeter";
import {
  invalidateHeadCache,
  liveTipCursorNames,
  readChainHead,
} from "@/lib/server/live/tokenIndexer";
import {
  LIVE_TIP_LOCK_APP_NAME,
  LIVE_TIP_LOCK_CLASS,
  LIVE_TIP_LOCK_ID,
  STALE_LOCK_OPS_HINT,
  decideLockWait,
  formatLockWaitDetails,
  heartbeatAgeFromSql,
  isSafeToTerminateHolder,
  lockSessionApplicationName,
  lockWaitBackoffMs,
  shouldLogLockWait,
  type LockHolderRow,
} from "@/lib/server/live/workerLock";

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
/** Extra pause after a pass that wrote rows so PostgREST is not hammered. */
const WRITE_PASS_PAUSE_MS = 400;

let exiting = false;
let workerPool: pg.Pool | null = null;
let lockClient: pg.PoolClient | null = null;

function alchemyWsUrl(): string | null {
  const wss = process.env.ALCHEMY_WSS_URL?.trim();
  if (wss?.startsWith("wss://")) return wss;
  const http = process.env.ALCHEMY_RPC_URL?.trim();
  if (http?.startsWith("https://")) return `wss://${http.slice("https://".length)}`;
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      {once: true},
    );
  });
}

function logFailure(label: string, error: unknown): void {
  console.error(label, formatUnknownError(error));
}

type HeadMode = "subscribe" | "poll";

class HeadFeed {
  mode: HeadMode = "poll";
  private ws: WebSocket | null = null;
  private waiters: Array<() => void> = [];
  private reconnectAttempt = 0;
  private closed = false;
  private reconnecting: Promise<void> | null = null;

  async start(): Promise<HeadMode> {
    const url = alchemyWsUrl();
    if (!url) {
      console.warn("live-tip heads: no ALCHEMY_WSS_URL; polling public RPC");
      this.mode = "poll";
      return this.mode;
    }
    const ok = await this.connect(url);
    this.mode = ok ? "subscribe" : "poll";
    if (!ok) {
      console.warn("live-tip heads: eth_subscribe failed; polling at block time");
    } else {
      console.info("live-tip heads: eth_subscribe(newHeads) on Alchemy WSS");
    }
    return this.mode;
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (this.mode !== "subscribe") return sleep(ms, signal);
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.waiters = this.waiters.filter((waiter) => waiter !== finish);
        resolve();
      };
      this.waiters.push(finish);
      void sleep(ms, signal).then(finish);
    });
  }

  close(): void {
    this.closed = true;
    this.wake();
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
  }

  private wake(): void {
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter();
  }

  private async connect(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (error) {
        logFailure("live-tip ws construct failed", error);
        finish(false);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        logFailure("live-tip ws subscribe timed out", new Error("no subscribe ack in 8s"));
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(false);
      }, 8_000);

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"]}),
        );
      });
      ws.addEventListener("message", (event) => {
        let msg: {
          id?: number;
          method?: string;
          result?: unknown;
          error?: {message?: string; code?: number};
        };
        try {
          msg = JSON.parse(String(event.data)) as typeof msg;
        } catch {
          return;
        }
        if (msg.id === 1) {
          clearTimeout(timer);
          if (msg.error) {
            logFailure("live-tip eth_subscribe rejected", msg.error);
            finish(false);
            return;
          }
          this.reconnectAttempt = 0;
          this.mode = "subscribe";
          finish(true);
          return;
        }
        if (msg.method === "eth_subscription") this.wake();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        if (!settled) finish(false);
      });
      ws.addEventListener("close", (event) => {
        clearTimeout(timer);
        this.ws = null;
        if (this.closed) return;
        if (this.mode === "subscribe") {
          console.warn(
            `live-tip ws closed code=${event.code} reason=${redactSecrets(event.reason || "")}; falling back to poll`,
          );
        }
        this.mode = "poll";
        this.wake();
        if (!settled) finish(false);
        void this.scheduleReconnect(url);
      });
    });
  }

  private async scheduleReconnect(url: string): Promise<void> {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = (async () => {
      const wait = backoffMs(this.reconnectAttempt);
      this.reconnectAttempt += 1;
      await sleep(wait);
      if (this.closed) return;
      const ok = await this.connect(url);
      if (ok) {
        this.mode = "subscribe";
        this.reconnectAttempt = 0;
        console.info("live-tip heads: resubscribed to newHeads");
        this.wake();
      } else {
        this.mode = "poll";
      }
    })().finally(() => {
      this.reconnecting = null;
    });
    await this.reconnecting;
  }
}

function rewritePoolConnectError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (isPoolerCheckoutTimeout(error)) throw poolerCheckoutTimeoutError();
  if (code === "ENETUNREACH" && /:[0-9a-f]{0,4}:/i.test(message)) {
    const host = new URL(parseAdminDatabaseUrl(process.env.DATABASE_URL ?? "")).hostname;
    throw ipv6UnreachableError(host);
  }
  if (code === "28P01" || /password authentication failed/i.test(message)) {
    throw passwordRejectedError();
  }
  throw error instanceof Error ? error : new Error(message);
}

async function openWorkerPool(): Promise<pg.Pool> {
  const target = describeAdminPgTarget();
  if (isTransactionPoolerPort(target.port)) {
    throw new Error(
      "DATABASE_URL is the transaction pooler (port 6543). " +
        "Advisory locks need a session. Use the session pooler on port 5432.",
    );
  }
  console.info(
    `live-tip: pg user=${target.user} host=${target.host} port=${target.port} ` +
      `passwordLen=${target.passwordLen} slash=${target.slash} at=${target.at} ` +
      `percent=${target.percent} brackets=${target.brackets} ` +
      `poolMax=${WORKER_POOL_MAX} lock=1 work<=${WORKER_POOL_MAX - 1}`,
  );
  const pool = await createAdminPool({
    max: WORKER_POOL_MAX,
    connectionTimeoutMillis: 30_000,
    idleTimeoutMillis: 10_000,
  });
  pool.on("error", (error) => {
    if (exiting) return;
    logFailure("live-tip postgres pool error", error);
  });
  return pool;
}

async function releaseWorkerPg(): Promise<void> {
  const held = lockClient;
  lockClient = null;
  if (held) {
    try {
      await held.query("select pg_advisory_unlock($1, $2)", [LIVE_TIP_LOCK_CLASS, LIVE_TIP_LOCK_ID]);
    } catch {
      // session may already be dead
    }
    try {
      held.release();
    } catch {
      // ignore
    }
  }
  const pool = workerPool;
  workerPool = null;
  if (pool) await pool.end().catch(() => undefined);
}

async function acquireLock(pool: pg.Pool): Promise<pg.PoolClient> {
  const lockWait = new AbortController();
  const abortWait = () => {
    exiting = true;
    lockWait.abort();
  };
  process.once("SIGTERM", abortWait);
  process.once("SIGINT", abortWait);

  let lastError: unknown;
  let client: pg.PoolClient | undefined;
  try {
    for (let connectAttempt = 0; connectAttempt < 8 && !exiting; connectAttempt++) {
      try {
        client = await pool.connect();
        client.on("error", (error) => {
          if (exiting) return;
          logFailure("live-tip lock session lost", error);
          exiting = true;
          void releaseWorkerPg().finally(() => process.exit(1));
        });
        break;
      } catch (error) {
        lastError = error;
        if (
          !isPoolerCheckoutTimeout(error) &&
          !(error instanceof Error && /session pooler timed out/i.test(error.message))
        ) {
          rewritePoolConnectError(error);
        }
        const wait = Math.min(5_000 * 2 ** connectAttempt, 30_000);
        console.warn(
          `live-tip: session pooler busy; retry in ${wait}ms (attempt ${connectAttempt + 1})`,
        );
        await sleep(wait, lockWait.signal);
      }
    }
    if (exiting) {
      throw new Error("live-tip: shutdown before lock session");
    }
    if (!client) {
      throw lastError instanceof Error ? lastError : poolerCheckoutTimeoutError();
    }

    const appName = lockSessionApplicationName();
    await client.query("select set_config('application_name', $1, false)", [appName]);
    console.info(
      `live-tip: lock session app=${appName} service=${process.env.RAILWAY_SERVICE_NAME ?? "local"} ` +
        `replica=${process.env.RAILWAY_REPLICA_ID ?? "n/a"} pid=${process.pid}`,
    );

    // Stay up and retry. Exit(1) on a held lock is a Railway restart loop:
    // overlapping deploys and leaked pooler sessions both look like "another worker".
    // Steal only when the holder is abandoned or the heartbeat is stale —
    // never unlock from this session.
    for (let attempt = 1; !exiting; attempt++) {
      const {rows} = await client.query<{pg_try_advisory_lock: boolean}>(
        "select pg_try_advisory_lock($1, $2) as pg_try_advisory_lock",
        [LIVE_TIP_LOCK_CLASS, LIVE_TIP_LOCK_ID],
      );
      if (rows[0]?.pg_try_advisory_lock) {
        console.info(
          `live-tip: advisory lock acquired (${LIVE_TIP_LOCK_CLASS},${LIVE_TIP_LOCK_ID}) ` +
            `poolMax=${WORKER_POOL_MAX} lockHeld=1 work<=${WORKER_POOL_MAX - 1}`,
        );
        return client;
      }

      const snapshot = await inspectLockWait(pool);
      const details = formatLockWaitDetails(snapshot);
      if (snapshot.decision === "healthy") {
        if (shouldLogLockWait(attempt)) {
          console.warn(
            `live-tip: another live worker is indexing; this replica will stay idle ` +
              `(attempt ${attempt}). ${details}. Keep exactly one Railway service on npm run worker.`,
          );
        }
      } else if (snapshot.decision === "steal") {
        if (shouldLogLockWait(attempt)) {
          console.warn(
            `live-tip: advisory lock held by a stale, missing, or abandoned holder; ` +
              `attempting steal (attempt ${attempt}). ${details}.`,
          );
        }
        const stolen = await tryStealStaleLock(pool);
        if (stolen) {
          console.warn("live-tip: terminated stale lock holder; retrying try_lock");
          continue;
        }
      } else if (shouldLogLockWait(attempt)) {
        console.warn(
          `live-tip: advisory lock held by another session; waiting ` +
            `(attempt ${attempt}). ${details}. Keep exactly one Railway service on npm run worker.`,
        );
      }

      await sleep(lockWaitBackoffMs(attempt), lockWait.signal);
    }
    throw new Error("live-tip: shutdown before advisory lock");
  } catch (error) {
    if (client) {
      try {
        client.release();
      } catch {
        // ignore
      }
      client = undefined;
    }
    throw error;
  } finally {
    process.removeListener("SIGTERM", abortWait);
    process.removeListener("SIGINT", abortWait);
  }
}

async function withWorkClient<T>(
  pool: pg.Pool,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

const LOCK_HOLDER_SQL = `
  select l.pid,
         a.state,
         a.application_name,
         a.query
  from pg_locks l
  left join pg_stat_activity a on a.pid = l.pid
  where l.locktype = 'advisory'
    and l.classid = $1
    and l.objid = $2
    and l.objsubid = 1
    and l.granted
    and l.pid is distinct from pg_backend_pid()`;

async function inspectLockWait(pool: pg.Pool): Promise<{
  decision: ReturnType<typeof decideLockWait>;
  ageMs: number | null;
  probeFailed: boolean;
  holders: LockHolderRow[];
}> {
  let ageMs: number | null = null;
  let probeFailed = false;
  let holders: LockHolderRow[] = [];

  try {
    ageMs = await withWorkClient(pool, async (work) => {
      try {
        const {rows} = await work.query<{age_ms: string | number | null}>(
          `select (extract(epoch from (now() - last_run_at)) * 1000)::bigint as age_ms
           from indexer_state where name = $1`,
          [LIVE_TIP_HEARTBEAT],
        );
        return heartbeatAgeFromSql(rows[0]?.age_ms ?? null);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!/last_run_at/i.test(text)) throw error;
        const {rows} = await work.query<{age_ms: string | number | null}>(
          `select (extract(epoch from (now() - updated_at)) * 1000)::bigint as age_ms
           from indexer_state where name = $1`,
          [LIVE_TIP_HEARTBEAT],
        );
        return heartbeatAgeFromSql(rows[0]?.age_ms ?? null);
      }
    });
  } catch (error) {
    logFailure("live-tip: heartbeat probe failed", error);
    probeFailed = true;
  }

  try {
    holders = await withWorkClient(pool, (work) =>
      work.query<LockHolderRow>(LOCK_HOLDER_SQL, [LIVE_TIP_LOCK_CLASS, LIVE_TIP_LOCK_ID]).then(
        (res) => res.rows,
      ),
    );
  } catch (error) {
    logFailure("live-tip: lock holder probe failed", error);
  }

  return {
    decision: decideLockWait({ageMs, probeFailed, holders}),
    ageMs,
    probeFailed,
    holders,
  };
}

async function tryStealStaleLock(pool: pg.Pool): Promise<boolean> {
  try {
    return await withWorkClient(pool, async (work) => {
      const {rows} = await work.query<LockHolderRow>(LOCK_HOLDER_SQL, [
        LIVE_TIP_LOCK_CLASS,
        LIVE_TIP_LOCK_ID,
      ]);
      const candidates = rows.filter((row) => isSafeToTerminateHolder(row));
      if (!candidates.length) {
        console.warn(
          `live-tip: stale lock but no safe holder to terminate. ${STALE_LOCK_OPS_HINT}`,
        );
        return false;
      }
      let killed = 0;
      for (const row of candidates) {
        try {
          const res = await work.query<{pg_terminate_backend: boolean}>(
            "select pg_terminate_backend($1) as pg_terminate_backend",
            [row.pid],
          );
          if (res.rows[0]?.pg_terminate_backend) {
            killed += 1;
            console.warn(
              `live-tip: terminated stale lock holder pid=${row.pid} ` +
                `state=${row.state ?? ""} app=${row.application_name ?? ""}`,
            );
          }
        } catch (error) {
          logFailure(`live-tip: pg_terminate_backend(${row.pid}) failed`, error);
        }
      }
      if (!killed) {
        console.warn(`live-tip: terminate returned false. ${STALE_LOCK_OPS_HINT}`);
      }
      return killed > 0;
    });
  } catch (error) {
    logFailure("live-tip: steal probe failed", error);
    console.warn(`live-tip: cannot inspect pg_locks. ${STALE_LOCK_OPS_HINT}`);
    return false;
  }
}

async function touchHeartbeat(pool: pg.Pool): Promise<void> {
  await withWorkClient(pool, async (client) => {
    try {
      await client.query(
        `insert into indexer_state (name, last_block, updated_at, last_run_at)
         values ($1, 0, now(), now())
         on conflict (name) do update
           set last_run_at = now(),
               updated_at = now()`,
        [LIVE_TIP_HEARTBEAT],
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!/last_run_at/i.test(text)) throw error;
      await client.query(
        `insert into indexer_state (name, last_block, updated_at)
         values ($1, 0, now())
         on conflict (name) do update set updated_at = now()`,
        [LIVE_TIP_HEARTBEAT],
      );
    }
  });
}

async function ensureHeartbeatColumns(pool: pg.Pool): Promise<void> {
  await withWorkClient(pool, (client) =>
    client.query(`
      alter table indexer_state add column if not exists last_run_at timestamptz;
      alter table indexer_state add column if not exists blocks_behind bigint;
    `),
  );
}

async function loadCursors(pool: pg.Pool): Promise<Map<string, bigint>> {
  const names = liveTipCursorNames();
  const held = emptyLiveCursors();
  const {rows} = await withWorkClient(pool, (client) =>
    client.query<{name: string; last_block: string}>(
      `select name, last_block::text as last_block
       from indexer_state
       where name = any($1::text[])`,
      [names],
    ),
  );
  for (const row of rows) held.set(row.name, BigInt(row.last_block));
  return held;
}

async function checkpoint(
  pool: pg.Pool,
  held: Map<string, bigint>,
  heartbeat: {head: bigint; behind: number},
): Promise<void> {
  await withWorkClient(pool, async (client) => {
    await client.query("begin");
    try {
      for (const [name, block] of held) {
        await client.query(
          `insert into indexer_state (name, last_block, updated_at)
           values ($1, $2, now())
           on conflict (name) do update
             set last_block = excluded.last_block,
                 updated_at = excluded.updated_at
           where excluded.last_block >= indexer_state.last_block`,
          [name, block.toString()],
        );
      }
      try {
        await client.query(
          `insert into indexer_state (name, last_block, updated_at, last_run_at, blocks_behind)
           values ($1, $2, now(), now(), $3)
           on conflict (name) do update
             set last_block = excluded.last_block,
                 updated_at = excluded.updated_at,
                 last_run_at = excluded.last_run_at,
                 blocks_behind = excluded.blocks_behind`,
          [LIVE_TIP_HEARTBEAT, heartbeat.head.toString(), heartbeat.behind],
        );
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!/last_run_at|blocks_behind/i.test(text)) throw error;
        await client.query(
          `insert into indexer_state (name, last_block, updated_at)
           values ($1, $2, now())
           on conflict (name) do update
             set last_block = excluded.last_block,
                 updated_at = excluded.updated_at`,
          [LIVE_TIP_HEARTBEAT, heartbeat.behind.toString()],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

async function publicHead(): Promise<bigint> {
  const res = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: []}),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const err = new Error(`public head HTTP ${res.status}`) as Error & {status: number};
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as {result?: string; error?: {message?: string; code?: number}};
  if (body.error) {
    const err = new Error(body.error.message ?? "public head rpc error") as Error & {code?: number};
    err.code = body.error.code;
    throw err;
  }
  const tip = BigInt(body.result ?? "0");
  if (tip === 0n) throw new Error("public head returned 0");
  return tip;
}

async function tip(): Promise<bigint> {
  try {
    return await readChainHead();
  } catch (error) {
    logFailure("live-tip indexer head failed; using public fetch", error);
    return publicHead();
  }
}

async function main(): Promise<void> {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!process.env.ALCHEMY_RPC_URL?.trim()) {
    console.warn("live-tip: ALCHEMY_RPC_URL unset; getLogs and token meta will use the public RPC");
  }

  const pool = await openWorkerPool();
  workerPool = pool;
  lockClient = await acquireLock(pool);
  await ensureHeartbeatColumns(pool);
  await touchHeartbeat(pool);

  // Warm the module-level viem clients once. They stay up for every tick.
  rpc();
  invalidateHeadCache();
  await readChainHead().catch((error) => {
    logFailure("live-tip warm head failed", error);
  });

  const held = await loadCursors(pool);
  const seenTokens = new Set<string>();

  const heads = new HeadFeed();
  const mode = await heads.start();

  let stopping = false;
  let currentPass: Promise<void> | null = null;
  const stop = new AbortController();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    exiting = true;
    console.info(`live-tip: ${signal}; finishing current batch`);
    stop.abort();
    heads.close();
    if (currentPass) await currentPass;
    try {
      invalidateHeadCache();
      const head = await tip();
      await checkpoint(pool, held, {head, behind: blocksBehindTip(head, held)});
    } catch (error) {
      logFailure("live-tip shutdown checkpoint failed", error);
    }
    await releaseWorkerPg();
    console.info("live-tip: checkpointed; exiting 0");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  let failures = 0;
  console.info(`live-tip worker started mode=${mode} cursors=${held.size}`);

  while (!stopping) {
    const behindBefore = blocksBehindTip(await tip().catch(() => 0n), held);
    const interval = pollIntervalMs(behindBefore, heads.mode === "subscribe");
    // newHeads fires every ~100ms. At tip that would re-scan factories and 429.
    if (paceCaughtUpSubscribe(behindBefore, heads.mode === "subscribe")) {
      await sleep(interval, stop.signal);
    } else {
      await heads.wait(interval, stop.signal);
    }
    if (stopping) break;

    currentPass = (async () => {
      const started = Date.now();
      try {
        await touchHeartbeat(pool);
        await waitForRpcBudget();
        invalidateHeadCache();
        const result = await indexLiveTipPass({
          ...WORKER_LIVE_TIP,
          heldCursors: held,
          seenTokens,
        });
        applyPassCursors(held, result.passes);
        const head = BigInt(result.head);
        const behind = blocksBehindTip(head, held);
        await checkpoint(pool, held, {head, behind});
        failures = 0;
        const upserts = rowsWritten(result.passes);
        console.info(
          `live-tip mode=${heads.mode} blocks=${blocksProcessed(result.passes)} ` +
            `upserts=${upserts} behind=${behind} ms=${Date.now() - started}`,
        );
        if (upserts > 0) {
          await sleep(Math.min(WRITE_PASS_PAUSE_MS + upserts * 50, 2_000), stop.signal);
        }
      } catch (error) {
        failures += 1;
        logFailure("live-tip pass failed", error);
        const wait = backoffMs(failures - 1);
        console.warn(`live-tip retry in ${wait}ms (attempt ${failures})`);
        await sleep(wait, stop.signal);
      }
    })();
    await currentPass;
    currentPass = null;
  }
}

main().catch((error) => {
  logFailure("live-tip worker crashed", error);
  void releaseWorkerPg().finally(() => process.exit(1));
});
