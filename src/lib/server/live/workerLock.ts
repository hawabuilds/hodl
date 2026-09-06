/**
 * Advisory-lock wait policy for the live-tip worker.
 * Pure helpers live here so tests do not import the worker process.
 *
 * Session-pooler advisory locks survive until the backend session dies.
 * `pg_advisory_unlock` only drops locks this session holds — a waiter
 * cannot unlock a leaked holder. Steal uses heartbeat age + terminate.
 */

export const LIVE_TIP_LOCK_CLASS = 4663;
export const LIVE_TIP_LOCK_ID = 1;
export const LIVE_TIP_LOCK_APP_NAME = "rwa-live-tip";

/** Holder is dead/leaked if heartbeat is this old (or missing). */
export const LOCK_STALE_MS = 2 * 60_000;

/** Another replica is healthy if heartbeat is newer than this. */
export const LOCK_FRESH_MS = 30_000;

/** Log "another live worker is indexing" every N failed attempts. */
export const HEALTHY_HOLDER_LOG_EVERY = 6;

export type LockWaitDecision = "steal" | "healthy" | "wait";

export function heartbeatAgeMs(
  lastRunAt: Date | string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (lastRunAt == null || lastRunAt === "") return null;
  const ms = lastRunAt instanceof Date ? lastRunAt.getTime() : Date.parse(String(lastRunAt));
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, nowMs - ms);
}

export function lockWaitDecision(ageMs: number | null): LockWaitDecision {
  if (ageMs == null) return "steal";
  if (ageMs < LOCK_FRESH_MS) return "healthy";
  if (ageMs >= LOCK_STALE_MS) return "steal";
  return "wait";
}

/** Postgres `extract(epoch)` / bigint often arrives as a string. */
export function heartbeatAgeFromSql(ageMs: number | string | null | undefined): number | null {
  if (ageMs == null || ageMs === "") return null;
  const n = typeof ageMs === "number" ? ageMs : Number(ageMs);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

export type LockHolderRow = {
  pid: number;
  state: string | null;
  application_name: string | null;
  query: string | null;
};

export type LockWaitInput = {
  ageMs: number | null;
  probeFailed?: boolean;
  holders?: LockHolderRow[];
};

/**
 * Hidden pg_stat_activity (null state/app/query) is common on Supabase and
 * is not proof the holder is dead. A visible idle session that is not a
 * live-tip lock client is a leaked pooler backend.
 */
export function holderLooksAbandoned(row: LockHolderRow): boolean {
  const state = (row.state ?? "").toLowerCase();
  const app = row.application_name ?? "";
  const query = row.query ?? "";
  if (looksLikeLiveTipLockSession(app, query)) return false;
  if (!state && !app && !query) return false;
  return state === "idle" || state === "idle in transaction";
}

/**
 * Heartbeat age alone is not enough: a leaked idle session can sit on the
 * lock while last_run_at still looks fresh (JS Date parse, or another writer).
 * Probe failure must steal — wait-forever was the previous bug.
 */
export function decideLockWait(input: LockWaitInput): LockWaitDecision {
  if (input.probeFailed) return "steal";
  const holders = input.holders ?? [];
  if (holders.some(holderLooksAbandoned)) return "steal";
  const age = lockWaitDecision(input.ageMs);
  if (age === "healthy" && holders.length === 0) return "wait";
  return age;
}

export function formatLockWaitDetails(input: LockWaitInput): string {
  const holder = input.holders?.[0];
  const age = input.ageMs == null ? "missing" : `${Math.round(input.ageMs)}ms`;
  const pid = holder?.pid ?? "none";
  const state = holder?.state?.trim() || "unknown";
  const app = holder?.application_name?.trim() || "unset";
  return (
    `heartbeatAge=${age} holderPid=${pid} state=${state} app=${app} ` +
    `probeFailed=${input.probeFailed ? "yes" : "no"}`
  );
}

export function lockSessionApplicationName(
  env: NodeJS.Dict<string> = process.env,
  pid = process.pid,
): string {
  const token = (value: string | undefined, fallback: string, max: number) => {
    const cleaned = (value?.trim() || fallback).replace(/[^\w.-]+/g, "-").slice(0, max);
    return cleaned || fallback;
  };
  const service = token(env.RAILWAY_SERVICE_NAME ?? env.RAILWAY_SERVICE_ID, "local", 20);
  const replica = token(env.RAILWAY_REPLICA_ID, String(pid), 16);
  return `${LIVE_TIP_LOCK_APP_NAME} ${service} ${replica}`.slice(0, 63);
}

export function looksLikeLiveTipLockSession(applicationName: string, query: string): boolean {
  if (/rwa-live-tip|live-tip/i.test(applicationName)) return true;
  return /pg_try_advisory_lock|pg_advisory_lock|pg_advisory_unlock/i.test(query);
}

export function looksLikeRandomAppQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/advisory/i.test(q)) return false;
  if (/^select\s+pg_/i.test(q)) return false;
  return /\b(select|insert|update|delete|with)\b/i.test(q);
}

export function isSafeToTerminateHolder(row: LockHolderRow, ownPid?: number): boolean {
  if (!Number.isFinite(row.pid) || row.pid <= 0) return false;
  if (ownPid != null && row.pid === ownPid) return false;
  const state = (row.state ?? "").toLowerCase();
  // Supabase often hides other backends in pg_stat_activity. A pid that
  // still appears in pg_locks for our advisory key is the holder.
  if (!state) return true;
  // Idle holders of this advisory key are safe — including a pooler
  // backend that was reused and is now running other SQL.
  return state === "idle" || state === "idle in transaction";
}

export function shouldLogLockWait(attempt: number, every = HEALTHY_HOLDER_LOG_EVERY): boolean {
  return attempt === 1 || attempt % every === 0;
}

export function lockWaitBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.min(Math.max(attempt, 1) - 1, 3), 30_000);
}

export const STALE_LOCK_OPS_HINT =
  "Stop ALL Railway services that run `npm run worker`, wait for the session " +
  "pooler idle timeout, then start exactly one worker service. The Next app " +
  "service must not use the repo railway.toml startCommand.";
