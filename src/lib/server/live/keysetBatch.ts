import {db, hasDatabase} from "../db";

/** Default and clamp. Jobs may set BATCH_PAGE; never OFFSET. */
export const BATCH_PAGE_DEFAULT = 500;
export const BATCH_PAGE_MIN = 200;
export const BATCH_PAGE_MAX = 2_000;

export function batchPageSize(raw = process.env.BATCH_PAGE): number {
  const n = Number(raw ?? BATCH_PAGE_DEFAULT);
  if (!Number.isFinite(n)) return BATCH_PAGE_DEFAULT;
  return Math.min(BATCH_PAGE_MAX, Math.max(BATCH_PAGE_MIN, Math.floor(n)));
}

export interface BatchCursor {
  lastKey: string | null;
  scanned: number;
}

export async function readBatchCursor(name: string): Promise<BatchCursor> {
  if (!hasDatabase) return {lastKey: null, scanned: 0};
  const {data, error} = await db()
    .from("batch_cursors")
    .select("last_key, scanned")
    .eq("name", name)
    .maybeSingle();
  if (error) {
    if (/batch_cursors|schema cache/i.test(error.message)) {
      console.warn("batch_cursors missing — paste scripts/schema-batch-cursors.sql");
      return {lastKey: null, scanned: 0};
    }
    throw error;
  }
  return {
    lastKey: data?.last_key ? String(data.last_key) : null,
    scanned: Number(data?.scanned ?? 0) || 0,
  };
}

export async function writeBatchCursor(
  name: string,
  lastKey: string | null,
  scanned: number,
): Promise<void> {
  if (!hasDatabase) return;
  const {error} = await db().from("batch_cursors").upsert({
    name,
    last_key: lastKey,
    scanned,
    updated_at: new Date().toISOString(),
  });
  if (error && /batch_cursors|schema cache/i.test(error.message)) {
    console.warn("batch_cursors write skipped — paste scripts/schema-batch-cursors.sql");
    return;
  }
  if (error) throw error;
}

export interface KeysetBatchResult {
  scanned: number;
  pages: number;
  extra: Record<string, number>;
  tokensPerMin: number;
  ms: number;
}

/**
 * Keyset walk: `where key > last order by key limit N`.
 * Checkpoints after every page. Kill and rerun — no lost work.
 */
export async function runKeysetBatch<T>(opts: {
  name: string;
  pageSize?: number;
  loadPage: (after: string | null, limit: number) => Promise<T[]>;
  keyOf: (row: T) => string;
  onPage: (page: T[]) => Promise<Record<string, number> | void>;
  readCursor?: (name: string) => Promise<BatchCursor>;
  writeCursor?: (name: string, lastKey: string | null, scanned: number) => Promise<void>;
  continueOnPageError?: boolean;
}): Promise<KeysetBatchResult> {
  const pageSize = opts.pageSize ?? batchPageSize();
  const readCursor = opts.readCursor ?? readBatchCursor;
  const writeCursor = opts.writeCursor ?? writeBatchCursor;
  const held = await readCursor(opts.name);
  let after = held.lastKey;
  let scanned = held.scanned;
  let pages = 0;
  const extra: Record<string, number> = {};
  const started = Date.now();
  if (after) {
    console.log(JSON.stringify({phase: "resume", name: opts.name, after, scanned}));
  }

  for (;;) {
    let page: T[];
    try {
      page = await opts.loadPage(after, pageSize);
    } catch (error) {
      console.error("keyset page load failed; stopping", error);
      extra.pageLoadFailed = (extra.pageLoadFailed ?? 0) + 1;
      break;
    }
    if (page.length === 0) break;
    try {
      const counts = (await opts.onPage(page)) ?? {};
      for (const [key, value] of Object.entries(counts)) {
        extra[key] = (extra[key] ?? 0) + value;
      }
    } catch (error) {
      console.error("keyset page failed; continuing", error);
      extra.pageFailed = (extra.pageFailed ?? 0) + 1;
      if (!opts.continueOnPageError) throw error;
    }
    after = opts.keyOf(page[page.length - 1]!);
    scanned += page.length;
    pages += 1;
    await writeCursor(opts.name, after, scanned);
    const ms = Date.now() - started;
    const tokensPerMin = ms > 0 ? Math.round(scanned / (ms / 60_000)) : 0;
    console.log(
      JSON.stringify({
        name: opts.name,
        scanned,
        pages,
        last: after,
        tokensPerMin,
        ...extra,
      }),
    );
    if (page.length < pageSize) break;
  }

  const ms = Date.now() - started;
  return {
    scanned,
    pages,
    extra,
    tokensPerMin: ms > 0 ? Math.round(scanned / (ms / 60_000)) : 0,
    ms,
  };
}

/** PostgREST keyset page on `address`. Never OFFSET. */
export function pageByAddress<T extends Record<string, unknown>>(
  table: string,
  columns: string,
) {
  return async (after: string | null, limit: number): Promise<T[]> => {
    let request = db()
      .from(table)
      .select(columns as never)
      .order("address", {ascending: true})
      .limit(limit);
    if (after) request = request.gt("address", after);
    const {data, error} = await request;
    if (error) throw error;
    return (data ?? []) as unknown as T[];
  };
}
