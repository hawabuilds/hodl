/**
 * Live-tip index pass. Cron and the Railway worker both call this —
 * do not copy the options into a second path.
 */
import {indexTokens, liveTipCursorNames, type IndexOptions, type IndexPass} from "./tokenIndexer";

export const LIVE_TIP_HEARTBEAT = "live-tip";

export const CRON_LIVE_TIP = {
  live: true,
  historical: false,
  refreshStats: false,
  skipImages: true,
  drainGap: false,
  writeCap: 8,
  maxBlocks: 1_000n,
  budgetMs: 45_000,
} as const satisfies IndexOptions;

export const WORKER_LIVE_TIP = {
  live: true,
  historical: false,
  refreshStats: false,
  skipImages: true,
  drainGap: false,
  maxBlocks: 1_000n,
  budgetMs: 0,
} as const satisfies IndexOptions;

export type LiveTipPassOptions = Omit<IndexOptions, keyof typeof WORKER_LIVE_TIP> &
  Partial<typeof WORKER_LIVE_TIP>;

export async function indexLiveTipPass(opts: LiveTipPassOptions = {}) {
  const result = await indexTokens({
    ...CRON_LIVE_TIP,
    ...opts,
  });
  if (opts.heldCursors) applyPassCursors(opts.heldCursors, result.passes);
  return result;
}

export function applyPassCursors(held: Map<string, bigint>, passes: IndexPass[]): void {
  for (const pass of passes) {
    const name = pass.factory.startsWith("tokens:") ? pass.factory : `tokens:${pass.factory}`;
    const next = BigInt(pass.cursorTo || "0");
    const prev = held.get(name) ?? 0n;
    if (next > prev) held.set(name, next);
  }
}

export function blocksBehindTip(head: bigint, held: Map<string, bigint>): number {
  let min = head;
  let saw = false;
  for (const [name, cursor] of held) {
    if (!name.endsWith(":live") || name.endsWith(":live-gap")) continue;
    if (cursor <= 0n) continue;
    saw = true;
    if (cursor < min) min = cursor;
  }
  if (!saw) return 0;
  const delta = head > min ? head - min : 0n;
  return Number(delta > 2_000_000_000n ? 2_000_000_000n : delta);
}

export function blocksProcessed(passes: IndexPass[]): number {
  let total = 0n;
  for (const pass of passes) {
    const from = BigInt(pass.from || "0");
    const to = BigInt(pass.to || "0");
    if (to > from) total += to - from;
  }
  return Number(total > 2_000_000_000n ? 2_000_000_000n : total);
}

export function rowsWritten(passes: IndexPass[]): number {
  return passes.reduce((n, pass) => n + pass.upserts, 0);
}

export function emptyLiveCursors(): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const name of liveTipCursorNames()) map.set(name, 0n);
  return map;
}

export function backoffMs(attempt: number, base = 400, cap = 30_000): number {
  const exp = Math.min(base * 2 ** Math.max(attempt, 0), cap);
  const jitter = Math.floor(Math.random() * Math.max(exp * 0.3, 1));
  return Math.min(exp + jitter, cap);
}

/** Robinhood blocks are ~100ms. Subscribe uses this as a missed-head safety net. */
export function pollIntervalMs(behind: number, subscribed: boolean): number {
  if (subscribed) return 2_000;
  if (behind > 200) return 50;
  if (behind > 20) return 100;
  if (behind > 0) return 150;
  return 250;
}

export function formatUnknownError(error: unknown): Record<string, unknown> {
  if (error == null) return {raw: String(error)};
  if (typeof error === "string") return {message: redactSecrets(error)};
  if (error instanceof Error) {
    const extra = error as Error & {
      cause?: unknown;
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      details?: unknown;
    };
    return {
      name: extra.name,
      message: redactSecrets(extra.message),
      status: extra.status ?? extra.statusCode ?? null,
      code: extra.code ?? null,
      details: extra.details ?? null,
      cause: extra.cause != null ? formatUnknownError(extra.cause) : null,
      stack: extra.stack ? redactSecrets(extra.stack) : null,
    };
  }
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    return {
      message: obj.message != null ? redactSecrets(String(obj.message)) : redactSecrets(safeJson(error)),
      status: obj.status ?? obj.statusCode ?? null,
      code: obj.code ?? null,
      cause: obj.cause != null ? formatUnknownError(obj.cause) : null,
    };
  }
  return {raw: redactSecrets(String(error))};
}

export function redactSecrets(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]")
    .replace(/alch_[A-Za-z0-9_-]+/gi, "[redacted]");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
