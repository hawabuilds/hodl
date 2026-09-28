/**
 * Drain parked `tokens:<factory>:live-gap` cursors toward the live tip.
 *
 * Minute cron owns `tokens:<factory>:live` and must not run this. Kill and
 * rerun freely — each window checkpoints before the next starts.
 *
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/backfill-live-gap.ts
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/backfill-live-gap.ts --once
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/backfill-live-gap.ts --concurrency=6
 */
import dns from "node:dns";
import pg from "pg";
import {ALL_FACTORIES} from "../src/lib/contracts";
import {upsertTokensAdmin} from "../src/lib/server/live/adminCatalogue";
import {indexTokens} from "../src/lib/server/live/tokenIndexer";
import type {TokenWrite} from "../src/lib/server/live/universeStore";

dns.setDefaultResultOrder("ipv4first");

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

/**
 * Blocks per drain window.
 *
 * 4,000 is the safe default and stays the default. It is also slow: a parked
 * gap of 15.7M blocks drains at roughly 8k blocks a round, which is days of
 * wall clock. The public RPC serves getLogs over far wider spans than this
 * (50k tested), and `writeCap` truncates the cursor to the last block it
 * actually wrote, so a wide window in a dense region simply checkpoints early
 * rather than losing launches. Widen it with `--window=N` when draining a
 * long outage, and leave it alone for an ordinary top-up.
 */
function windowArg(): bigint {
  const flag = process.argv.find((arg) => arg.startsWith("--window="));
  if (!flag) return 4_000n;
  const parsed = Number(flag.slice("--window=".length));
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--window must be a positive number, got ${flag}`);
  }
  return BigInt(Math.floor(parsed));
}

const WINDOW = windowArg();

/**
 * Token writes in flight per pass.
 *
 * `indexLiveGaps` pins this to 1 so the minute cron cannot stampede the RPC;
 * `indexFactory` itself defaults to 8. Serial writes are what make a long
 * drain crawl — each token costs a round of metadata and pool reads, so a
 * dense window spends minutes writing a few dozen rows. This is an admin job
 * with the chain to itself, so it can afford more. Default stays 1.
 */
function concurrencyArg(): number {
  const flag = process.argv.find((arg) => arg.startsWith("--concurrency="));
  if (!flag) return 1;
  const parsed = Number(flag.slice("--concurrency=".length));
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--concurrency must be a positive number, got ${flag}`);
  }
  return Math.floor(parsed);
}

const WRITE_CONCURRENCY = concurrencyArg();
const WRITE_CAP = 128;
const PASS_BUDGET_MS = 90_000;
const REORG = 30n;
const LIVE_IDS = ALL_FACTORIES
  .filter((factory) => factory.id !== "long-factory" && factory.id !== "pons-v3")
  .map((factory) => factory.id);

function redact(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]");
}

function databaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (!raw) throw new Error("DATABASE_URL is not set");
  return (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
    ? raw.slice(1, -1)
    : raw;
}

async function connectAdmin(): Promise<pg.Client> {
  const url = databaseUrl();
  const local = /localhost|127\.0\.0\.1/i.test(url);
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const client = new pg.Client({
      connectionString: url,
      ssl: local ? undefined : {rejectUnauthorized: false},
      connectionTimeoutMillis: 60_000,
    });
    client.on("error", (error) => {
      console.warn(`admin pg error: ${redact(error.message).slice(0, 160)}`);
    });
    try {
      await client.connect();
      await client.query("SET statement_timeout = 0");
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`admin postgres connect failed: ${redact(message)}`);
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connectAdmin();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
}

function serviceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

async function chainHead(): Promise<bigint> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(PUBLIC_RPC, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: []}),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`public head HTTP ${res.status}`);
      const body = (await res.json()) as {result?: string};
      const tip = body.result ? BigInt(body.result) : 0n;
      if (tip === 0n) throw new Error("public RPC returned empty head");
      return tip;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("public head failed");
}

type CursorRow = {name: string; last_block: string};

async function readCursors(client: import("pg").Client): Promise<Map<string, bigint>> {
  const {rows} = await client.query<CursorRow>(
    `select name, last_block::text as last_block
     from indexer_state
     where name like 'tokens:%:live'
        or name like 'tokens:%:live-gap'
     order by name`,
  );
  return new Map(rows.map((row) => [row.name, BigInt(row.last_block)]));
}

async function writeGapCursor(client: import("pg").Client, name: string, block: bigint): Promise<void> {
  await client.query(
    `insert into indexer_state (name, last_block, updated_at)
     values ($1, $2, now())
     on conflict (name) do update
       set last_block = excluded.last_block, updated_at = excluded.updated_at
     where excluded.last_block > indexer_state.last_block`,
    [name, block.toString()],
  );
}

async function restNewest(): Promise<{symbol: string; launchpad: string | null; listed_at: string; address: string}[]> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/tokens?select=symbol,launchpad,listed_at,address&listed_at=not.is.null&or=(eligible.is.null,eligible.is.true)&order=listed_at.desc&limit=8`,
    {
      headers: {
        apikey: serviceKey(),
        Authorization: `Bearer ${serviceKey()}`,
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`rest newest HTTP ${res.status}`);
  return res.json();
}

async function restPonsAfter(iso: string): Promise<{symbol: string; listed_at: string; address: string}[]> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/tokens?select=symbol,listed_at,address&launchpad=eq.pons&listed_at=gt.${encodeURIComponent(iso)}&or=(eligible.is.null,eligible.is.true)&order=listed_at.desc&limit=12`,
    {
      headers: {
        apikey: serviceKey(),
        Authorization: `Bearer ${serviceKey()}`,
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`rest pons HTTP ${res.status}`);
  return res.json();
}

interface FactoryGap {
  id: string;
  gap: bigint;
  live: bigint;
  behind: bigint;
}

function factoryGaps(cursors: Map<string, bigint>): FactoryGap[] {
  return LIVE_IDS.map((id) => {
    const gap = cursors.get(`tokens:${id}:live-gap`) ?? 0n;
    const live = cursors.get(`tokens:${id}:live`) ?? 0n;
    const behind = live > gap + REORG ? live - gap : 0n;
    return {id, gap, live, behind};
  });
}

function remainingOf(rows: FactoryGap[]): bigint {
  return rows.reduce((sum, row) => sum + row.behind, 0n);
}

function reportGaps(label: string, head: bigint, rows: FactoryGap[]) {
  console.warn(
    JSON.stringify({
      at: label,
      head: head.toString(),
      remaining: remainingOf(rows).toString(),
      factories: rows.map((row) => ({
        id: row.id,
        gap: row.gap.toString(),
        live: row.live.toString(),
        behind: row.behind.toString(),
        liveBehindHead: (head > row.live ? head - row.live : 0n).toString(),
      })),
    }),
  );
}

const once = process.argv.includes("--once");
let stop = false;
process.on("SIGINT", () => {
  stop = true;
  console.warn("SIGINT — finishing current window");
});
process.on("SIGTERM", () => {
  stop = true;
  console.warn("SIGTERM — finishing current window");
});

async function snapshot(label: string) {
  const head = await chainHead();
  const cursors = await withAdmin(readCursors);
  reportGaps(label, head, factoryGaps(cursors));
  try {
    console.warn(JSON.stringify({newest: await restNewest()}));
    console.warn(JSON.stringify({ponsAfterInvestment: await restPonsAfter("2026-09-05T00:49:00Z")}));
  } catch (error) {
    console.warn(`newest snapshot skipped: ${redact(String(error)).slice(0, 160)}`);
  }
  return {head, cursors};
}

async function main() {
  console.warn(`drain window ${WINDOW} blocks, write cap ${WRITE_CAP}, concurrency ${WRITE_CONCURRENCY}`);
  const {cursors: cursors0} = await snapshot("before");
  const gaps0 = factoryGaps(cursors0);
  if (remainingOf(gaps0) === 0n) {
    console.warn("live-gap already caught the live tip");
    return;
  }

  let idle = 0;
  let rounds = 0;
  let upserts = 0;
  while (!stop) {
    const remainBefore = remainingOf(factoryGaps(await withAdmin(readCursors)));
    if (remainBefore === 0n) break;

    const started = Date.now();
    try {
      const held = await withAdmin(readCursors);
      const persistWrites = async (rows: TokenWrite[]) => {
        await withAdmin((client) => upsertTokensAdmin(client, rows));
      };
      const result = await indexTokens({
        live: false,
        historical: false,
        drainGap: true,
        refreshStats: false,
        skipImages: true,
        writeCap: WRITE_CAP,
        writeConcurrency: WRITE_CONCURRENCY,
        maxBlocks: WINDOW,
        budgetMs: PASS_BUDGET_MS,
        heldCursors: held,
        persistWrites,
      });
      await withAdmin(async (client) => {
        for (const pass of result.passes) {
          const key = pass.factory.startsWith("tokens:") ? pass.factory : `tokens:${pass.factory}`;
          if (!key.endsWith(":live-gap")) continue;
          const next = BigInt(pass.cursorTo || "0");
          const prev = held.get(key) ?? 0n;
          if (next > prev) await writeGapCursor(client, key, next);
        }
      });
      rounds += 1;
      const passUpserts = result.passes.reduce((n, pass) => n + pass.upserts, 0);
      upserts += passUpserts;

      const head = await chainHead();
      const after = factoryGaps(await withAdmin(readCursors));
      const remainAfter = remainingOf(after);
      console.warn(
        JSON.stringify({
          round: rounds,
          ms: Date.now() - started,
          upserts: passUpserts,
          remaining: remainAfter.toString(),
          advanced: (remainBefore > remainAfter ? remainBefore - remainAfter : 0n).toString(),
          passes: result.passes.map((pass) => ({
            factory: pass.factory,
            from: pass.from,
            to: pass.to,
            cursorTo: pass.cursorTo,
            upserts: pass.upserts,
          })),
          liveBehindHead: after.map((row) => ({
            id: row.id,
            live: row.live.toString(),
            behindHead: (head > row.live ? head - row.live : 0n).toString(),
          })),
        }),
      );

      if (once) break;
      if (remainAfter === 0n) break;
      if (remainAfter >= remainBefore) {
        idle += 1;
        const wait = Math.min(8_000 * idle, 60_000);
        console.warn(`no gap progress; backing off ${wait}ms`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      } else {
        idle = 0;
      }
    } catch (error) {
      idle += 1;
      const wait = Math.min(8_000 * idle, 60_000);
      console.warn(
        `gap round failed; reconnecting in ${wait}ms: ${redact(String(error)).slice(0, 200)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (once) throw error;
    }
  }

  const {cursors: cursors1} = await snapshot(stop ? "stopped" : "after");
  const gaps1 = factoryGaps(cursors1);
  console.log(
    JSON.stringify({
      done: !stop && remainingOf(gaps1) === 0n,
      rounds,
      upserts,
      remaining: remainingOf(gaps1).toString(),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? redact(error.message) : error);
  process.exit(1);
});
