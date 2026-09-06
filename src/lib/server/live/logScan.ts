/**
 * getLogs window + public-RPC 429 policy for the live-tip indexer.
 *
 * Public Robinhood RPC is the live tip only — Alchemy's head has sat stale.
 * When ALCHEMY_RPC_URL is set, every getLogs (catch-up and subscribe) uses
 * that HTTP client. Catch-up used to keep 128-block public windows and 429
 * until cursors were marked done without the launches.
 * If Alchemy is unset, keep the small public windows.
 */

/** Alchemy plan cap. Live tip scans must stay at or under this on that client. */
export const ALCHEMY_GETLOGS_MAX = 10n;
/** Public RPC, caught up: one small request, not a 500–900 block window. */
export const LIVE_TIP_LOG_WINDOW = 48n;
/** Public RPC while the live worker is still walking toward head. */
export const CATCHUP_LOG_WINDOW = 128n;
/** Historical / admin gap walks. */
export const HISTORICAL_LOG_WINDOW = 8_000n;
export const MIN_LOG_WINDOW = 8n;
/** Reorg overlap when the live cursor is already at tip. */
export const LIVE_TIP_REORG = 4n;
export const CATCHUP_REORG = 30n;

const CAUGHT_UP_BEHIND = 32;

export function liveScanMaxBlocks(behind: number | bigint): bigint {
  const n =
    typeof behind === "bigint"
      ? Number(behind > 2_000_000_000n ? 2_000_000_000n : behind)
      : behind;
  if (!Number.isFinite(n) || n <= CAUGHT_UP_BEHIND) return LIVE_TIP_LOG_WINDOW;
  if (n <= 200) return 128n;
  return 1_000n;
}

export function liveReorgBlocks(caughtUp: boolean): bigint {
  return caughtUp ? LIVE_TIP_REORG : CATCHUP_REORG;
}

export function isLiveCaughtUp(behind: number | bigint): boolean {
  const n =
    typeof behind === "bigint"
      ? Number(behind > 2_000_000_000n ? 2_000_000_000n : behind)
      : behind;
  return Number.isFinite(n) && n <= CAUGHT_UP_BEHIND;
}

export function useAlchemyForLogs(opts: {
  hasAlchemy: boolean;
  caughtUp?: boolean;
  span?: bigint;
}): boolean {
  return opts.hasAlchemy;
}

/**
 * Cursor after a factory log walk. An incomplete fetch must not jump to
 * `plannedEnd` — that is how 429s skipped launches and still reported behind=0.
 */
export function cursorAfterLogScan(opts: {
  stored: bigint;
  plannedEnd: bigint;
  scannedTo: bigint | null;
  complete: boolean;
  writeCapEnd?: bigint | null;
}): bigint {
  if (!opts.complete || opts.scannedTo == null) {
    const partial = opts.scannedTo;
    if (partial == null || partial <= opts.stored) return opts.stored;
    if (opts.writeCapEnd != null && opts.writeCapEnd < partial) return opts.writeCapEnd;
    return partial;
  }
  return opts.writeCapEnd != null ? opts.writeCapEnd : opts.plannedEnd;
}

/**
 * lastOk is in-memory. After a discarded 429 pass it can sit ahead of the
 * persisted cursor; resuming from it skips those launches. Only skip overlap
 * that the DB cursor already covers.
 */
export function resumeIfPersisted(
  lastOk: bigint | undefined,
  requestedFrom: bigint,
  persistedCursor: bigint,
): bigint {
  if (lastOk == null) return requestedFrom;
  if (lastOk > persistedCursor + 64n) return requestedFrom;
  return nextUnscannedFrom(lastOk, requestedFrom);
}

function clampWindow(window: bigint, span: bigint): bigint {
  if (span <= 0n) return 1n;
  return window < span ? window : span;
}

export function getLogsStartWindow(opts: {
  caughtUp: boolean;
  alchemy: boolean;
  live?: boolean;
  span: bigint;
}): bigint {
  if (opts.alchemy) {
    return clampWindow(ALCHEMY_GETLOGS_MAX, opts.span);
  }
  if (opts.caughtUp) return clampWindow(LIVE_TIP_LOG_WINDOW, opts.span);
  if (opts.live) return clampWindow(CATCHUP_LOG_WINDOW, opts.span);
  return clampWindow(HISTORICAL_LOG_WINDOW, opts.span);
}

/** 4s, 8s, 16s, … — does not reset per getLogs call. */
export function rateLimitBackoffMs(strikes: number, base = 4_000, cap = 60_000): number {
  const n = Math.max(0, Math.floor(strikes));
  return Math.min(base * 2 ** n, cap);
}

export function rangesOverlap(
  aFrom: bigint,
  aTo: bigint,
  bFrom: bigint,
  bTo: bigint,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

export function shouldSkipRateLimitedRange(
  last: {from: bigint; to: bigint; until: number} | null,
  from: bigint,
  to: bigint,
  now: number,
): boolean {
  if (!last || now >= last.until) return false;
  return rangesOverlap(from, to, last.from, last.to);
}

/**
 * After a successful tip scan, the next tick's reorg overlap should not
 * re-fetch the same range. Gap / historical walks that start far behind
 * lastOk must not jump forward.
 */
export function nextUnscannedFrom(
  lastOkTo: bigint | null | undefined,
  requestedFrom: bigint,
  tinyReorg = LIVE_TIP_REORG,
): bigint {
  if (lastOkTo == null) return requestedFrom;
  if (requestedFrom + 64n < lastOkTo) return requestedFrom;
  const resume = lastOkTo > tinyReorg ? lastOkTo - tinyReorg : 0n;
  return resume > requestedFrom ? resume : requestedFrom;
}

export function shrinkLogWindow(window: bigint, floor = MIN_LOG_WINDOW): bigint {
  const next = window / 2n;
  return next < floor ? floor : next;
}

export class LogScanLimiter {
  strikes = 0;
  last: {from: bigint; to: bigint; until: number} | null = null;
  lastOk = new Map<string, bigint>();

  remainingCooldown(now = Date.now()): number {
    if (!this.last) return 0;
    return Math.max(0, this.last.until - now);
  }

  shouldSkip(from: bigint, to: bigint, now = Date.now()): boolean {
    return shouldSkipRateLimitedRange(this.last, from, to, now);
  }

  note429(from: bigint, to: bigint, now = Date.now()): number {
    const wait = rateLimitBackoffMs(this.strikes);
    this.strikes += 1;
    this.last = {from, to, until: now + wait};
    return wait;
  }

  noteOk(key: string, to: bigint): void {
    if (this.strikes > 0) this.strikes -= 1;
    this.last = null;
    const prev = this.lastOk.get(key);
    if (prev == null || to > prev) this.lastOk.set(key, to);
  }

  resumeFrom(key: string, requestedFrom: bigint): bigint {
    return nextUnscannedFrom(this.lastOk.get(key), requestedFrom);
  }
}
