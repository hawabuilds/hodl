/**
 * Nullable boolean flags on `tokens` (`eligible`, `is_tradeable`, …).
 *
 *   true  = evaluated, passes  → show
 *   false = evaluated, fails   → hide
 *   null  = NOT YET EVALUATED  → show
 *
 * Filtering `.eq(column, true)` or SQL `AND column` collapses three states
 * into two. New indexer rows default to null (or, worse, false) and vanish
 * from the feed. That emptied the app three times.
 *
 * Postgres:  `column IS DISTINCT FROM false`
 * PostgREST: `.or("column.is.null,column.is.true")` — never `.eq(column, true)`
 * JS:        `value !== false`
 */

export type ThreeStateFlag = "eligible" | "is_tradeable";

export function showsThreeState(value: boolean | null | undefined): boolean {
  return value !== false;
}

/** PostgREST equivalent of `column IS DISTINCT FROM false`. */
export function applyThreeStateFilter<T>(request: T, column: ThreeStateFlag): T {
  return (request as {or: (filter: string) => T}).or(
    `${column}.is.null,${column}.is.true`,
  );
}
