import type {TokenAsset} from "./types";
import {qualifiesForUniverse} from "./tokenUniverse";

/** Same set as the home feed and New sort. */
export function qualifiesForSearch(token: TokenAsset): boolean {
  return qualifiesForUniverse(token);
}

export type SearchCategory = "pons" | "long" | "rewards" | "rwa";

/** Broad category queries that should return a whole slice of the chain index. */
export function searchCategory(query: string): SearchCategory | null {
  const q = query.trim().toLowerCase();
  if (q === "pons" || q === "pon") return "pons";
  if (q === "long") return "long";
  if (q === "rewards" || q === "reward") return "rewards";
  if (q === "rwa" || q === "rwa tokens" || q === "rwa token") return "rwa";
  return null;
}

export function matchesSearchCategory(
  token: TokenAsset,
  category: SearchCategory,
): boolean {
  if (!qualifiesForUniverse(token)) return false;
  const id = token.launchpad?.id;
  if (category === "pons") return id === "pons";
  if (category === "long") return id === "long";
  if (category === "rewards") {
    return token.paysRwaRewards || token.rewardsToHolders;
  }
  if (category === "rwa") return token.rwaPaired;
  return true;
}
