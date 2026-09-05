/**
 * Drain parked `tokens:<factory>:live-gap` cursors toward the live tip.
 *
 * Minute cron owns `tokens:<factory>:live` and must not run this. Kill and
 * rerun freely — each window checkpoints before the next starts.
 *
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/backfill-live-gap.ts
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/backfill-live-gap.ts --once
 */
import dns from "node:dns";
import pg from "pg";
import {ALL_FACTORIES} from "../src/lib/contracts";
import {indexTokens} from "../src/lib/server/live/tokenIndexer";

dns.setDefaultResultOrder("ipv4first");

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const WINDOW = 4_000n;
const WRITE_CAP = 32;
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
  const client = new pg.Client({
    connectionString: url,
    ssl: local ? undefined : {rejectUnauthorized: false},
    connectionTimeoutMillis: 60_000,
  });
  try {
    await client.connect();
    await client.query("SET statement_timeout = 0");
  } catch (error) {
    await client.end().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`admin postgres connect failed: ${redact(message)}`);
  }
  return client;
}

function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
}

function serviceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

async function chainHead(): Promise<bigint> {
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

async function main() {
  const client = await connectAdmin();
  try {
    const head0 = await chainHead();
    const cursors0 = await readCursors(client);
    const gaps0 = factoryGaps(cursors0);
    reportGaps("before", head0, gaps0);
    try {
      console.warn(JSON.stringify({newest: await restNewest()}));
      console.warn(JSON.stringify({ponsAfterInvestment: await restPonsAfter("2026-09-05T00:49:00Z")}));
    } catch (error) {
      console.warn(`newest snapshot skipped: ${redact(String(error)).slice(0, 160)}`);
    }

    if (remainingOf(gaps0) === 0n) {
      console.warn("live-gap already caught the live tip");
      return;
    }

    let idle = 0;
    let rounds = 0;
    let upserts = 0;
    while (!stop) {
      const before = factoryGaps(await readCursors(client));
      const remainBefore = remainingOf(before);
      if (remainBefore === 0n) break;

      const started = Date.now();
      const held = await readCursors(client);
      const result = await indexTokens({
        live: false,
        historical: false,
        drainGap: true,
        refreshStats: false,
        skipImages: true,
        writeCap: WRITE_CAP,
        maxBlocks: WINDOW,
        budgetMs: PASS_BUDGET_MS,
        heldCursors: held,
      });
      for (const pass of result.passes) {
        const key = pass.factory.startsWith("tokens:") ? pass.factory : `tokens:${pass.factory}`;
        if (!key.endsWith(":live-gap")) continue;
        const next = BigInt(pass.cursorTo || "0");
        const prev = held.get(key) ?? 0n;
        if (next > prev) await writeGapCursor(client, key, next);
      }
      rounds += 1;
      const passUpserts = result.passes.reduce((n, pass) => n + pass.upserts, 0);
      upserts += passUpserts;

      const head = await chainHead();
      const after = factoryGaps(await readCursors(client));
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
    }

    const head1 = await chainHead();
    const gaps1 = factoryGaps(await readCursors(client));
    reportGaps(stop ? "stopped" : "after", head1, gaps1);
    try {
      console.warn(JSON.stringify({newest: await restNewest()}));
      console.warn(JSON.stringify({ponsAfterInvestment: await restPonsAfter("2026-09-05T00:49:00Z")}));
    } catch (error) {
      console.warn(`newest snapshot skipped: ${redact(String(error)).slice(0, 160)}`);
    }
    console.log(
      JSON.stringify({
        done: !stop && remainingOf(gaps1) === 0n,
        rounds,
        upserts,
        remaining: remainingOf(gaps1).toString(),
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? redact(error.message) : error);
  process.exit(1);
});
