import type {AssetKind} from "./types";

/**
 * The opening book.
 *
 * A brand-new account with nothing in it makes the portfolio tab impossible to
 * read, so the first run is seeded with four positions across both sides of the
 * universe. Entry prices are expressed as a multiple of the live price rather
 * than as fixed dollars, so the sample shows a realistic mix of winners and
 * losers whatever the market happens to be doing when someone signs up.
 */
export interface SamplePosition {
  kind: AssetKind;
  /** Resolved through the batch endpoint, which accepts a ticker or a symbol. */
  lookup: string;
  costUsd: number;
  /** Entry price as a fraction of the current one. Below 1 means in profit. */
  entryFactor: number;
}

export const SAMPLE_POSITIONS: SamplePosition[] = [
  {kind: "rwa", lookup: "nvda", costUsd: 2400, entryFactor: 0.86},
  {kind: "rwa", lookup: "spy", costUsd: 1800, entryFactor: 1.04},
  {kind: "token", lookup: "gpucoin", costUsd: 600, entryFactor: 0.45},
  {kind: "token", lookup: "fission", costUsd: 350, entryFactor: 1.6},
];

export const SAMPLE_CASH_USD = 4850;
