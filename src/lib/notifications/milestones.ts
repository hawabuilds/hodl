/** Multiples that can fire. Order matters: we report the highest crossed. */
export const MILESTONES = [2, 3, 5, 10, 25, 50, 100] as const;
export type Milestone = (typeof MILESTONES)[number];

export const DEFAULT_HOLDINGS_MULTIPLES: Milestone[] = [2, 5, 10];
export const DEFAULT_WATCHLIST_MULTIPLES: Milestone[] = [2, 5, 10];

/** Highest enabled milestone at or below ratio. 1.8x→6x with defaults → 5. */
export function highestMilestone(
  ratio: number,
  enabled: readonly number[],
  alreadyFired: readonly number[],
): Milestone | null {
  if (!(ratio >= 2)) return null;
  const allow = new Set(enabled);
  const fired = new Set(alreadyFired);
  let hit: Milestone | null = null;
  for (const step of MILESTONES) {
    if (!allow.has(step)) continue;
    if (ratio + 1e-9 < step) break;
    if (fired.has(step)) continue;
    hit = step;
  }
  return hit;
}

/**
 * A jump across several rungs is one notification (the highest new one).
 * Lower unfired rungs are marked consumed so 5x after a 6x print does not fire.
 */
export function consumeThrough(
  reached: Milestone,
  enabled: readonly number[],
): Milestone[] {
  const allow = new Set(enabled);
  return MILESTONES.filter((step) => allow.has(step) && step <= reached);
}

export function multipleRatio(mark: number, reference: number): number | null {
  if (!(reference > 0) || !(mark > 0)) return null;
  return mark / reference;
}
