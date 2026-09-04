/**
 * Resolve the real Uniswap V3 pool for every row in tokens.
 *
 *   npm run backfill:pools
 *
 * Keyset pagination (address > last_seen). Checkpointed after each batch
 * so a crash resumes exactly where it stopped.
 *
 * Requires scripts/schema-pools.sql and scripts/schema-backfill.sql.
 */
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {createClient} from "@supabase/supabase-js";
import {normalizeAddress} from "../src/lib/address";
import {discoverV3Pools, pickBestPool} from "../src/lib/server/live/v3Pools";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  {auth: {persistSession: false}},
);

const PAGE = 500;
const CHUNK = 25;
const JOB = "pools";
const LOCAL_CURSOR = join(process.cwd(), "scripts", ".backfill-pools-cursor.json");

function readLocalCursor(): {
  last_address: string;
  processed: number;
  with_pool: number;
} | null {
  try {
    return JSON.parse(readFileSync(LOCAL_CURSOR, "utf8"));
  } catch {
    return null;
  }
}

function writeLocalCursor(cursor: {
  last_address: string;
  processed: number;
  with_pool: number;
}): void {
  writeFileSync(LOCAL_CURSOR, JSON.stringify(cursor));
}

async function loadCursor(): Promise<{
  last_address: string;
  processed: number;
  with_pool: number;
}> {
  const {data, error} = await db
    .from("backfill_cursors")
    .select("last_address, processed, with_pool")
    .eq("job", JOB)
    .maybeSingle();
  if (error) {
    if (/backfill_cursors|schema cache/i.test(error.message)) {
      console.warn("backfill_cursors missing — using local file until schema-backfill.sql is applied");
      return readLocalCursor() ?? {last_address: "", processed: 0, with_pool: 0};
    }
    throw error;
  }
  return {
    last_address: data?.last_address ?? "",
    processed: Number(data?.processed ?? 0),
    with_pool: Number(data?.with_pool ?? 0),
  };
}

async function saveCursor(cursor: {
  last_address: string;
  processed: number;
  with_pool: number;
}): Promise<void> {
  writeLocalCursor(cursor);
  const {error} = await db.from("backfill_cursors").upsert({
    job: JOB,
    last_address: cursor.last_address,
    processed: cursor.processed,
    with_pool: cursor.with_pool,
    updated_at: new Date().toISOString(),
  });
  if (error && !/backfill_cursors|schema cache/i.test(error.message)) throw error;
}

async function main() {
  let cursor = await loadCursor();
  console.log(JSON.stringify({resume: cursor}));

  for (;;) {
    let request = db
      .from("tokens")
      .select("address, pair_address, launchpad_contract")
      .order("address", {ascending: true})
      .limit(PAGE);
    if (cursor.last_address) {
      request = request.gt("address", cursor.last_address);
    }
    const {data, error} = await request;
    if (error) {
      if (/pool_address|launchpad_contract/i.test(error.message)) {
        throw new Error("run scripts/schema-pools.sql in the Supabase SQL editor first");
      }
      throw error;
    }
    const rows = (data ?? []) as {
      address: string;
      pair_address: string | null;
      launchpad_contract: string | null;
    }[];
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const discovered = await discoverV3Pools(slice.map((row) => row.address));
      const poolInserts: {
        token: string;
        pool_address: string;
        fee_tier: number;
        quote_token: string;
        liquidity: string;
        updated_at: string;
      }[] = [];
      const now = new Date().toISOString();

      for (const row of slice) {
        const hits = discovered.get(row.address.toLowerCase()) ?? [];
        const best = pickBestPool(hits);
        const payload: Record<string, unknown> = {};
        if (!row.launchpad_contract && row.pair_address) {
          payload.launchpad_contract = row.pair_address;
        }
        if (best) {
          payload.pool_address = best.pool;
          payload.fee_tier = best.fee;
          payload.pool_quote_token = best.quote;
          payload.pool_liquidity = best.liquidity.toString();
          cursor.with_pool += 1;
        }
        if (Object.keys(payload).length > 0) {
          const {error: upErr} = await db
            .from("tokens")
            .update(payload)
            .eq("address", normalizeAddress(row.address));
          if (upErr) throw upErr;
        }
        for (const hit of hits) {
          poolInserts.push({
            token: normalizeAddress(row.address),
            pool_address: hit.pool,
            fee_tier: hit.fee,
            quote_token: hit.quote,
            liquidity: hit.liquidity.toString(),
            updated_at: now,
          });
        }
      }

      if (poolInserts.length > 0) {
        const tokens = slice.map((row) => normalizeAddress(row.address));
        await db.from("token_pools").delete().in("token", tokens);
        const {error: insErr} = await db.from("token_pools").insert(poolInserts);
        if (insErr) {
          if (/token_pools/i.test(insErr.message)) {
            throw new Error("run scripts/schema-pools.sql in the Supabase SQL editor first");
          }
          throw insErr;
        }
      }
    }

    cursor.last_address = rows[rows.length - 1].address;
    cursor.processed += rows.length;
    await saveCursor(cursor);
    console.log(
      JSON.stringify({
        last_address: cursor.last_address,
        page: rows.length,
        processed: cursor.processed,
        withPool: cursor.with_pool,
      }),
    );
    if (rows.length < PAGE) break;
  }

  console.log(
    JSON.stringify({
      done: true,
      processed: cursor.processed,
      withPool: cursor.with_pool,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
