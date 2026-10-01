/**
 * Mini-chart points as lists send them: the line's shape as whole numbers
 * 0–999 (its own low to its own high), which is all a 110px chart can show,
 * at a fraction of the bytes of raw prices. The row's % is worked out from the
 * same real prices on the server, so the line always starts and ends where
 * the % says.
 */
export const SPARK_SCALE = 999;

export function encodeSpark(prices: readonly number[]): number[] {
  const finite = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (finite.length === 0) return [];
  const series = finite.length === 1 ? [finite[0], finite[0]] : finite;
  const min = Math.min(...series);
  const max = Math.max(...series);
  // Flat (no trades, or no move): a level line, drawn mid-height.
  if (max - min <= max * 1e-9) return series.map(() => Math.round(SPARK_SCALE / 2));
  return series.map((price) => Math.round(((price - min) / (max - min)) * SPARK_SCALE));
}

/** Percent change from the first point to the last, the number the row shows. */
export function sparkChangePct(prices: readonly number[]): number {
  const finite = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (finite.length < 2) return 0;
  return (finite[finite.length - 1] / finite[0] - 1) * 100;
}

/**
 * A stock's day line that starts at the previous close and ends at the price
 * shown, so it moves exactly as much as the day's % says. The close is the
 * shown price taken back by that % — the same two numbers the row prints —
 * and the intraday prints in between are Robinhood's real ones.
 */
export function anchorDayLine(intraday: readonly number[], price: number | null, changePct: number | null): number[] {
  const line = intraday.filter((value) => Number.isFinite(value) && value > 0);
  if (price == null || !(price > 0) || changePct == null || !Number.isFinite(changePct) || changePct <= -100) {
    return [...line];
  }
  const previousClose = price / (1 + changePct / 100);
  return [previousClose, ...line, price];
}
