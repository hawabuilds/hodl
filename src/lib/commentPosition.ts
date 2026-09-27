/**
 * What a commenter did in the asset they are commenting on.
 *
 * A comment on a trading screen is a claim — "this runs from here" — and the
 * most useful thing to put beside a claim is whether the person making it has
 * money on it. So each comment carries its author's position in that one
 * asset, derived from the position hodl already tracks for them: what they put
 * in, whether they still hold, and how it has gone.
 *
 * All of it is derived, never typed. A commenter cannot claim a position they
 * do not have, because there is no field to claim it in.
 */

import type {CommentPositionView} from "@/lib/types";

/**
 * A row of `user_positions`: the amount held, what it is worth now, and what
 * it cost. `costUsd` is nullable because hodl cannot always establish a basis
 * — a transfer in, or a position first seen before it was tracked.
 */
export interface PositionRow {
  amount: number;
  valueUsd: number;
  costUsd: number | null;
}

/**
 * Below this the holding is dust, not a position.
 *
 * Selling out through a router routinely leaves a few base units behind, and
 * calling that "holding" would label someone a holder of something they sold.
 */
export const DUST_USD = 0.01;

export function commentPosition(row: PositionRow | null): CommentPositionView | null {
  if (!row) return null;

  const amount = Number.isFinite(row.amount) ? row.amount : 0;
  const valueUsd = Number.isFinite(row.valueUsd) ? row.valueUsd : 0;
  const costUsd =
    row.costUsd !== null && Number.isFinite(row.costUsd) ? row.costUsd : null;

  const holding = amount > 0 && valueUsd >= DUST_USD;

  // Never held and nothing invested: there is no position to describe, and
  // inventing one would be guessing.
  if (!holding && !(costUsd !== null && costUsd > 0)) return null;

  /*
   * The return, only when every input to it is real.
   *
   * Without a cost basis there is no honest percentage to show — a holder
   * whose basis we never captured is not someone who is up 0%. The badge
   * still says they hold; the number is simply left off.
   */
  const gainPct =
    costUsd !== null && costUsd > 0 ? ((valueUsd - costUsd) / costUsd) * 100 : null;

  return {
    boughtUsd: costUsd ?? 0,
    status: holding ? "holding" : "sold",
    // A sold position's current value is zero, so a percentage computed from
    // it would read as -100% rather than as the result they actually got.
    gainPct: holding ? gainPct : null,
  };
}

/** Whether this position lets its owner speak here. */
export function positionCanComment(row: PositionRow | null): boolean {
  if (!row) return false;
  if (!Number.isFinite(row.amount) || row.amount <= 0) return false;
  // A price we could not read must not silence a real holder, so a zero value
  // with a positive amount still counts.
  if (!Number.isFinite(row.valueUsd) || row.valueUsd === 0) return true;
  return row.valueUsd >= DUST_USD;
}
