/**
 * What this process has asked the chain for.
 *
 * The provider bills on volume and the allowance is finite, so the thing that
 * matters operationally is knowing which feature is spending it — the peak that
 * prompted this was diagnosed by putting a counting proxy in front of the
 * provider, which is not something anyone can do against production.
 *
 * Counters are per process and reset with it. That is the right shape for a
 * serverless deployment: each instance reports its own rate, and a rate is what
 * an allowance is actually consumed at.
 */

export interface RpcSnapshot {
  /** Seconds this process has been counting. */
  uptimeSeconds: number;
  /** JSON-RPC calls, which is what the provider counts. */
  calls: number;
  callsPerMinute: number;
  byMethod: Record<string, number>;
  /** Calls attributed to a feature, where the caller named one. */
  byFeature: Record<string, number>;
  /** Loads served from a cache instead of the chain. */
  cacheHits: number;
  cacheMisses: number;
  /** Requests that failed and were retried. */
  retries: number;
  /** True once the rate has been over budget — see `RATE_BUDGET_PER_MINUTE`. */
  overBudget: boolean;
}

/**
 * The rate this app should never reach in normal operation.
 *
 * Measured baseline after the tape was deduplicated: a market rebuild is around
 * forty calls a minute, a chart page around thirty per open token, and search
 * is the only other spender of consequence. Four hundred a minute is well above
 * anything observed and far below a rate that would exhaust an allowance
 * unnoticed, which makes it a useful line to be told about crossing.
 */
export const RATE_BUDGET_PER_MINUTE = 400;

interface MeterState {
  startedAt: number;
  calls: number;
  retries: number;
  cacheHits: number;
  cacheMisses: number;
  alarmed: boolean;
  byMethod: Map<string, number>;
  byFeature: Map<string, number>;
  feature: string | null;
}

/**
 * Held on `globalThis` rather than in module scope.
 *
 * The bundler gives each route chunk its own copy of a module, so counters kept
 * in module scope count only the routes that happen to share a chunk — the
 * meter read zero from its own endpoint while the tape beside it was making
 * requests. One object on the global, shared by every chunk in the instance,
 * is what makes the number mean what it says.
 */
const GLOBAL_KEY = Symbol.for("rwa.rpcMeter");

function state(): MeterState {
  const host = globalThis as {[GLOBAL_KEY]?: MeterState};
  if (!host[GLOBAL_KEY]) {
    host[GLOBAL_KEY] = {
      startedAt: Date.now(),
      calls: 0,
      retries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      alarmed: false,
      byMethod: new Map(),
      byFeature: new Map(),
      feature: null,
    };
  }
  return host[GLOBAL_KEY];
}

/**
 * Names the feature responsible for chain work started inside `run`.
 *
 * Deliberately not an async-context store: the counters are advisory, and a
 * module-level label is enough to attribute the sequential server work this app
 * actually does without paying for `AsyncLocalStorage` on every request.
 */
export async function underFeature<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const s = state();
  const previous = s.feature;
  s.feature = name;
  try {
    return await run();
  } finally {
    s.feature = previous;
  }
}

function bump(map: Map<string, number>, key: string, by: number) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Records outbound JSON-RPC calls. One HTTP request may carry several. */
export function recordCalls(methods: string[]): void {
  if (methods.length === 0) return;
  const s = state();
  s.calls += methods.length;
  for (const method of methods) bump(s.byMethod, method, 1);
  if (s.feature) bump(s.byFeature, s.feature, methods.length);

  if (!s.alarmed && ratePerMinute() > RATE_BUDGET_PER_MINUTE) {
    s.alarmed = true;
    // Once per process: the point is to be told, not to fill the log with the
    // same line every second while the rate stays high.
    console.error(
      `rpc budget: ${ratePerMinute().toFixed(0)} calls/min exceeds ` +
        `${RATE_BUDGET_PER_MINUTE}. Busiest: ${busiest()}`,
    );
  }
}

export function recordRetry(): void {
  state().retries++;
}

export function recordCacheHit(): void {
  state().cacheHits++;
}

export function recordCacheMiss(): void {
  state().cacheMisses++;
}

function ratePerMinute(): number {
  const s = state();
  const minutes = (Date.now() - s.startedAt) / 60_000;
  if (minutes <= 0) return 0;
  return s.calls / minutes;
}

function busiest(): string {
  const top = [...state().byMethod.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return top.map(([method, n]) => `${method}=${n}`).join(", ") || "none";
}

/** Reads the request payload and counts whatever methods it carries. */
export function recordPayload(body: unknown): void {
  if (Array.isArray(body)) {
    recordCalls(
      body
        .map((entry) =>
          entry && typeof entry === "object" && "method" in entry
            ? String((entry as {method: unknown}).method)
            : null,
        )
        .filter((method): method is string => method !== null),
    );
    return;
  }

  if (body && typeof body === "object" && "method" in body) {
    recordCalls([String((body as {method: unknown}).method)]);
  }
}

export function rpcSnapshot(): RpcSnapshot {
  const s = state();
  const uptimeSeconds = (Date.now() - s.startedAt) / 1000;
  return {
    uptimeSeconds: Number(uptimeSeconds.toFixed(1)),
    calls: s.calls,
    callsPerMinute: Number(ratePerMinute().toFixed(1)),
    byMethod: Object.fromEntries(
      [...s.byMethod.entries()].sort((a, b) => b[1] - a[1]),
    ),
    byFeature: Object.fromEntries(
      [...s.byFeature.entries()].sort((a, b) => b[1] - a[1]),
    ),
    cacheHits: s.cacheHits,
    cacheMisses: s.cacheMisses,
    retries: s.retries,
    overBudget: ratePerMinute() > RATE_BUDGET_PER_MINUTE,
  };
}
