/**
 * Always-on live-tip indexer. Railway runs exactly one replica.
 *
 * Shares `indexLiveTipPass` with the Vercel cron. Turn that cron off once
 * this process is keeping pace — two indexers racing is worse than one stall.
 */
import pg from "pg";
import {hasDatabase} from "@/lib/server/db";
import {rpc} from "@/lib/server/live/chain";
import {adminPgConfig, ipv6UnreachableError, parseAdminDatabaseUrl} from "@/lib/server/live/adminPg";
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

const LOCK_CLASS = 4663;
const LOCK_ID = 1;
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

let exiting = false;

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

async function createPool(): Promise<pg.Pool> {
  const config = await adminPgConfig();
  const pool = new pg.Pool({
    ...config,
    max: 3,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 30_000,
  });
  pool.on("error", (error) => {
    logFailure("live-tip pg pool error", error);
  });
  return pool;
}

async function acquireLock(): Promise<pg.Client> {
  const config = await adminPgConfig();
  const client = new pg.Client({
    ...config,
    connectionTimeoutMillis: 30_000,
  });
  client.on("error", (error) => {
    if (exiting) return;
    logFailure("live-tip lock connection lost", error);
    process.exit(1);
  });
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => undefined);
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : String(error);
    if (code === "ENETUNREACH" && /:[0-9a-f]{0,4}:/i.test(message)) {
      const host = new URL(parseAdminDatabaseUrl(process.env.DATABASE_URL ?? "")).hostname;
      throw ipv6UnreachableError(host);
    }
    throw error;
  }
  const {rows} = await client.query<{pg_try_advisory_lock: boolean}>(
    "select pg_try_advisory_lock($1, $2) as pg_try_advisory_lock",
    [LOCK_CLASS, LOCK_ID],
  );
  if (!rows[0]?.pg_try_advisory_lock) {
    await client.end().catch(() => undefined);
    console.error("live-tip: another worker holds the advisory lock; exiting");
    process.exit(1);
  }
  console.info(`live-tip: advisory lock acquired (${LOCK_CLASS},${LOCK_ID})`);
  return client;
}

async function ensureHeartbeatColumns(pool: pg.Pool): Promise<void> {
  await pool.query(`
    alter table indexer_state add column if not exists last_run_at timestamptz;
    alter table indexer_state add column if not exists blocks_behind bigint;
  `);
}

async function loadCursors(pool: pg.Pool): Promise<Map<string, bigint>> {
  const names = liveTipCursorNames();
  const held = emptyLiveCursors();
  const {rows} = await pool.query<{name: string; last_block: string}>(
    `select name, last_block::text as last_block
     from indexer_state
     where name = any($1::text[])`,
    [names],
  );
  for (const row of rows) held.set(row.name, BigInt(row.last_block));
  return held;
}

async function checkpoint(
  pool: pg.Pool,
  held: Map<string, bigint>,
  heartbeat: {head: bigint; behind: number},
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
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
  } finally {
    client.release();
  }
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
    console.warn("live-tip: ALCHEMY_RPC_URL unset; token meta will use the public RPC");
  }

  const lock = await acquireLock();
  const pool = await createPool();
  await ensureHeartbeatColumns(pool);

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
    await pool.end().catch(() => undefined);
    await lock.end().catch(() => undefined);
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
    await heads.wait(pollIntervalMs(behindBefore, heads.mode === "subscribe"), stop.signal);
    if (stopping) break;

    currentPass = (async () => {
      const started = Date.now();
      try {
        await waitForRpcBudget();
        invalidateHeadCache();
        const result = await indexLiveTipPass({
          ...WORKER_LIVE_TIP,
          writeCap: undefined,
          heldCursors: held,
          seenTokens,
        });
        applyPassCursors(held, result.passes);
        const head = BigInt(result.head);
        const behind = blocksBehindTip(head, held);
        await checkpoint(pool, held, {head, behind});
        failures = 0;
        console.info(
          `live-tip mode=${heads.mode} blocks=${blocksProcessed(result.passes)} ` +
            `upserts=${rowsWritten(result.passes)} behind=${behind} ms=${Date.now() - started}`,
        );
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
  process.exit(1);
});
