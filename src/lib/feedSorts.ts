/**
 * How the feeds are ordered, shared by the phone feed and the desktop board.
 *
 * These lived inline in the Home page. The desktop board shows the same lists
 * side by side, and two copies of an ordering drift the first time someone
 * tunes one — at which point "Trending" means one thing on a phone and another
 * on a monitor. So there is one, and both call it.
 */

import type {RwaSort, TokenSort} from "./homeState";
import {compareTrendingMomentum} from "./trendingScore";
import type {RwaAsset, TokenAsset} from "./types";

/** Every token ordering that ranks a list. `new` is a feed of its own. */
export type RankedTokenSort = Exclude<TokenSort, "new">;

export function sortTokens(tokens: readonly TokenAsset[], sort: RankedTokenSort): TokenAsset[] {
  const list = [...tokens];
  switch (sort) {
    case "marketCap":
      return list.sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
    case "trending":
      return list.sort(compareTrendingMomentum);
  }
}

export function sortRwas(rwas: readonly RwaAsset[], sort: RwaSort): RwaAsset[] {
  const list = [...rwas];
  // Movers ranks by the size of the move, not its direction — a stock down
  // nine percent is as much of a mover as one up nine.
  return sort === "movers"
    ? list.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    : list.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
}
