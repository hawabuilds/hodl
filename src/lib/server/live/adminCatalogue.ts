/**
 * Admin-only Postgres (DATABASE_URL). Scripts import this — never the app
 * client or Next routes. App reads stay on PostgREST.
 *
 * Do not log DATABASE_URL.
 */
import pg from "pg";
import {normalizeAddress} from "@/lib/address";
import type {LaunchpadId, QuoteKind} from "@/lib/universe";
import type {BatchCursor} from "./keysetBatch";
import type {PricingCoverage, TokenRow, TokenWrite} from "./universeStore";
import {writeQualifies} from "./universeStore";

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

export async function connectAdmin(): Promise<pg.Client> {
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

export interface AdminPriceRow {
  address: string;
  launchpad: LaunchpadId | null;
  decimals: number;
  total_supply: number | null;
  quote_token: string | null;
  quote_kind: QuoteKind | null;
}

export async function listListedForPricing(
  client: pg.Client,
  opts: {
    afterAddress?: string | null;
    limit: number;
    onlyUnpriced?: boolean;
    minLiquidity?: number | null;
  },
): Promise<AdminPriceRow[]> {
  const limit = Math.min(Math.max(Math.floor(opts.limit) || 1, 1), 2_000);
  const after = opts.afterAddress ?? null;
  const minLiq =
    opts.minLiquidity != null && opts.minLiquidity > 0 ? opts.minLiquidity : null;
  const onlyUnpriced = opts.onlyUnpriced === true;

  const {rows} = await client.query<AdminPriceRow>(
    `select t.address, t.launchpad, t.decimals, t.total_supply, t.quote_token, t.quote_kind
     from tokens t
     left join token_stats s on s.address = t.address
     where t.status = 'listed'
       and t.launchpad is not null
       and t.eligible is distinct from false
       and ($1::text is null or t.address > $1)
       and ($2::numeric is null or t.liquidity_usd >= $2)
       and (
         $3::boolean = false
         or (
           s.priced_at is null
           and s.price_status is distinct from 'no_pool'
           and s.price_status is distinct from 'failed'
         )
       )
     order by t.address
     limit $4`,
    [after, minLiq, onlyUnpriced, limit],
  );
  return rows;
}

export async function readBatchCursor(
  client: pg.Client,
  name: string,
): Promise<BatchCursor> {
  const {rows} = await client.query<{last_key: string | null; scanned: string | number}>(
    `select last_key, scanned from batch_cursors where name = $1`,
    [name],
  );
  const row = rows[0];
  if (!row) return {lastKey: null, scanned: 0};
  return {
    lastKey: row.last_key ? String(row.last_key) : null,
    scanned: Number(row.scanned ?? 0) || 0,
  };
}

export async function writeBatchCursor(
  client: pg.Client,
  name: string,
  lastKey: string | null,
  scanned: number,
): Promise<void> {
  await client.query(
    `insert into batch_cursors (name, last_key, scanned, updated_at)
     values ($1, $2, $3, now())
     on conflict (name) do update
       set last_key = excluded.last_key,
           scanned = excluded.scanned,
           updated_at = excluded.updated_at`,
    [name, lastKey, scanned],
  );
}

export async function pricingCoverage(client: pg.Client): Promise<PricingCoverage> {
  const {rows} = await client.query<{
    listed_eligible: string;
    measured: string;
    no_pool: string;
    failed: string;
  }>(
    `select
       (select count(*) from tokens
         where status = 'listed'
           and launchpad is not null
           and eligible is distinct from false) as listed_eligible,
       (select count(*) from token_stats
         where priced_at is not null and last_mcap > 0) as measured,
       (select count(*) from token_stats where price_status = 'no_pool') as no_pool,
       (select count(*) from token_stats where price_status = 'failed') as failed`,
  );
  const row = rows[0];
  const listedEligible = Number(row?.listed_eligible ?? 0);
  const measured = Number(row?.measured ?? 0);
  return {
    listedEligible,
    measured,
    ratio: listedEligible > 0 ? measured / listedEligible : 0,
    noPool: Number(row?.no_pool ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

export function asTokenRows(rows: AdminPriceRow[]): TokenRow[] {
  return rows as TokenRow[];
}

const TOKEN_UPSERT_COLUMNS = [
  "address",
  "chain_id",
  "launchpad",
  "symbol",
  "name",
  "decimals",
  "pair_address",
  "launchpad_contract",
  "pool_address",
  "fee_tier",
  "pool_quote_token",
  "pool_liquidity",
  "quote_token",
  "quote_kind",
  "reward_rwa",
  "reward_kind",
  "creator",
  "tax_buy",
  "tax_sell",
  "total_supply",
  "created_at",
  "bonded_at",
  "listed_at",
  "status",
  "eligible",
  "indexed_at",
] as const;

/**
 * Admin upsert for the gap job. Never touches image blobs. App cron stays
 * on PostgREST — do not import this from Next routes.
 */
export async function upsertTokensAdmin(
  client: pg.Client,
  rows: TokenWrite[],
): Promise<number> {
  const now = new Date().toISOString();
  const accepted = rows.filter((row) => writeQualifies(row));
  if (accepted.length === 0) return 0;

  const values: unknown[] = [];
  const tuples = accepted.map((row, index) => {
    const base = index * TOKEN_UPSERT_COLUMNS.length;
    values.push(
      normalizeAddress(row.address),
      row.chain_id ?? 4663,
      row.launchpad,
      row.symbol ?? null,
      row.name ?? null,
      row.decimals ?? 18,
      row.pair_address ?? null,
      row.launchpad_contract ?? null,
      row.pool_address ?? null,
      row.fee_tier ?? null,
      row.pool_quote_token ?? null,
      row.pool_liquidity ?? null,
      row.quote_token ?? null,
      row.quote_kind ?? null,
      row.reward_rwa ?? null,
      row.reward_kind ?? null,
      row.creator ?? null,
      row.tax_buy ?? null,
      row.tax_sell ?? null,
      row.total_supply ?? null,
      row.created_at ?? now,
      row.bonded_at ?? null,
      row.listed_at ?? null,
      row.status,
      true,
      now,
    );
    return `(${TOKEN_UPSERT_COLUMNS.map((_, col) => `$${base + col + 1}`).join(",")})`;
  });

  const updates = TOKEN_UPSERT_COLUMNS.filter((col) => col !== "address")
    .map((col) => `${col} = excluded.${col}`)
    .join(", ");

  await client.query(
    `insert into tokens (${TOKEN_UPSERT_COLUMNS.join(",")})
     values ${tuples.join(",")}
     on conflict (address) do update set ${updates}`,
    values,
  );
  return accepted.length;
}
