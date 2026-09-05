/**
 * One-shot live tip pass (no history, no images). Used to latch production
 * cursors after a stall. Safe to rerun.
 *
 * Cursor writes go through DATABASE_URL in one short transaction.
 */
import dns from "node:dns";
import pg from "pg";
import {ALL_FACTORIES} from "../src/lib/contracts";
import {indexTokens} from "../src/lib/server/live/tokenIndexer";

dns.setDefaultResultOrder("ipv4first");

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const LIVE_LOOKBACK = 12_000n;
const WINDOW = 2_400n;
const LIVE_IDS = ALL_FACTORIES
  .filter((factory) => factory.id !== "long-factory" && factory.id !== "pons-v3")
  .map((factory) => factory.id);

function databaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (!raw) throw new Error("DATABASE_URL is not set");
  return (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
    ? raw.slice(1, -1)
    : raw;
}

function redact(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]");
}

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = databaseUrl();
  const local = /localhost|127\.0\.0\.1/i.test(url);
  const client = new pg.Client({
    connectionString: url,
    ssl: local ? undefined : {rejectUnauthorized: false},
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
    query_timeout: 8_000,
  });
  try {
    await client.connect();
    await client.query("SET statement_timeout = '15s'");
    return await fn(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(message));
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function chainHead(): Promise<bigint> {
  const alchemyUrl = process.env.ALCHEMY_RPC_URL?.trim() ?? "";
  const reads = await Promise.allSettled(
    [
      alchemyUrl
        ? fetch(alchemyUrl, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: []}),
            signal: AbortSignal.timeout(8_000),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`alchemy HTTP ${res.status}`);
            return BigInt(((await res.json()) as {result: string}).result);
          })
        : Promise.resolve(0n),
      fetch(PUBLIC_RPC, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: []}),
        signal: AbortSignal.timeout(8_000),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`public HTTP ${res.status}`);
        return BigInt(((await res.json()) as {result: string}).result);
      }),
    ],
  );
  const alchemy = reads[0].status === "fulfilled" ? reads[0].value : 0n;
  const pub = reads[1].status === "fulfilled" ? reads[1].value : 0n;
  const best = alchemy > pub ? alchemy : pub;
  if (best === 0n) throw new Error("could not read chain head");
  if (alchemy > 0n && pub > 0n && (alchemy > pub ? alchemy - pub : pub - alchemy) > 30n) {
    console.warn(`chain head mismatch alchemy=${alchemy} public=${pub} using=${best}`);
  }
  return best;
}

function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
}

function serviceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

async function restUpsertCursor(name: string, block: bigint): Promise<void> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/indexer_state`, {
    method: "POST",
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      name,
      last_block: Number(block),
      updated_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`rest cursor ${name} HTTP ${res.status}`);
}

async function restReadCursors(): Promise<Record<string, string>> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/indexer_state?select=name,last_block`, {
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`rest cursors HTTP ${res.status}`);
  const rows = (await res.json()) as {name: string; last_block: number}[];
  const out: Record<string, string> = {};
  for (const id of LIVE_IDS) {
    out[`tokens:${id}:live`] = "0";
    out[`tokens:${id}:live-gap`] = "0";
  }
  for (const row of rows) out[row.name] = String(row.last_block);
  return out;
}

async function restNewest() {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/tokens?select=symbol,listed_at,address&listed_at=not.is.null&order=listed_at.desc&limit=5`,
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

async function latchViaRest(tip: bigint) {
  const cursors = await restReadCursors();
  const latched: string[] = [];
  const seed = tip > WINDOW ? tip - WINDOW : 0n;
  for (const id of LIVE_IDS) {
    const liveKey = `tokens:${id}:live`;
    const stored = BigInt(cursors[liveKey] ?? "0");
    if (stored === 0n || tip <= stored || tip - stored <= LIVE_LOOKBACK) continue;
    const gapKey = `tokens:${id}:live-gap`;
    const gapHeld = BigInt(cursors[gapKey] ?? "0");
    if (gapHeld === 0n || gapHeld > stored) {
      await restUpsertCursor(gapKey, stored);
    }
    await restUpsertCursor(liveKey, seed);
    latched.push(`${liveKey} lagged ${tip - stored} latching to ${seed}`);
  }
  return {
    latched,
    cursors: await restReadCursors(),
    newest: await restNewest(),
  };
}

async function latchAndRead(tip: bigint) {
  try {
    return await withDb(async (client) => {
    const {rows: before} = await client.query<{name: string; last_block: string}>(
      `select name, last_block::text as last_block from indexer_state
       where name like 'tokens:%live%' order by name`,
    );
    const map = new Map(before.map((row) => [row.name, BigInt(row.last_block)]));
    const latched: string[] = [];
    const seed = tip > WINDOW ? tip - WINDOW : 0n;

    await client.query("begin");
    try {
      for (const id of LIVE_IDS) {
        const liveKey = `tokens:${id}:live`;
        const stored = map.get(liveKey) ?? 0n;
        if (stored !== 0n && tip > stored && tip - stored > LIVE_LOOKBACK) {
          const gapKey = `tokens:${id}:live-gap`;
          const gapHeld = map.get(gapKey) ?? 0n;
          if (gapHeld === 0n || gapHeld > stored) {
            await client.query(
              `insert into indexer_state (name, last_block, updated_at)
               values ($1, $2, now())
               on conflict (name) do update
                 set last_block = excluded.last_block, updated_at = excluded.updated_at`,
              [gapKey, stored.toString()],
            );
          }
          await client.query(
            `insert into indexer_state (name, last_block, updated_at)
             values ($1, $2, now())
             on conflict (name) do update
               set last_block = excluded.last_block, updated_at = excluded.updated_at`,
            [liveKey, seed.toString()],
          );
          latched.push(`${liveKey} lagged ${tip - stored} latching to ${seed}`);
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }

    const {rows: cursors} = await client.query<{name: string; last_block: string}>(
      `select name, last_block::text as last_block from indexer_state
       where name like 'tokens:%live%' order by name`,
    );
    const {rows: newest} = await client.query<{symbol: string; listed_at: string; address: string}>(
      `select symbol, listed_at::text as listed_at, address
       from tokens where listed_at is not null
       order by listed_at desc limit 5`,
    );
    return {latched, cursors, newest};
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.warn(`DATABASE_URL latch failed (${text.slice(0, 80)}); using PostgREST`);
    return latchViaRest(tip);
  }
}

async function main() {
  console.warn("live-index latch starting");
  const tip = await chainHead();
  console.warn(`chain head ${tip}`);
  const snapshot = await latchAndRead(tip);
  for (const line of snapshot.latched) console.warn(line);
  if (snapshot.latched.length === 0) console.warn("live cursors already near head");

  let result: unknown = {skipped: "index after snapshot"};
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    result = await Promise.race([
      indexTokens({
        live: true,
        historical: false,
        refreshStats: false,
        skipImages: true,
        writeCap: 8,
        maxBlocks: WINDOW,
        budgetMs: 25_000,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("indexTokens timed out after 50s")), 50_000);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.warn(`indexTokens skipped: ${text.slice(0, 180)}`);
    result = {error: text.slice(0, 180)};
  }

  console.log(
    JSON.stringify(
      {head: tip.toString(), ...snapshot, result},
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? redact(error.message) : error);
  process.exit(1);
});
