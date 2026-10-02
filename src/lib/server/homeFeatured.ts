import type {TokenAsset} from "@/lib/types";
import {cachedPage} from "./live/cache";
import {pairStats} from "./rwasBoard";
import {tokensTablePage} from "./tokensTable";

/**
 * Home's "Most token volume today": the RWA whose paired tokens traded most
 * in the last 24h, summed over every listed token in the tokens table (the
 * same counts as the RWAs page's "paired volume"), with its four busiest
 * tokens. Rebuilt at most every few minutes and kept in Redis like any page,
 * so Home never waits on it.
 */
export interface HomeFeatured {
  /** The leading RWA's ticker; null before any paired token has traded today. */
  ticker: string | null;
  /** Its paired tokens' combined 24h volume, USD. */
  tokenVolumeUsd: number;
  /** How many of its paired tokens traded in the last 24h. */
  tokens: number;
  /** Its busiest paired tokens, at most four, with their mini charts. */
  paired: TokenAsset[];
  builtAt: number;
}

const FEATURED_TTL_MS = 3 * 60_000;

export function homeFeatured(): Promise<HomeFeatured> {
  return cachedPage("page:home-featured", FEATURED_TTL_MS, async (): Promise<HomeFeatured> => {
    const stats = await pairStats();
    let ticker: string | null = null;
    for (const [candidate, stat] of Object.entries(stats)) {
      if (stat.volumeUsd > 0 && (ticker === null || stat.volumeUsd > stats[ticker].volumeUsd)) ticker = candidate;
    }
    if (ticker === null) return {ticker: null, tokenVolumeUsd: 0, tokens: 0, paired: [], builtAt: Date.now()};
    const page = await tokensTablePage({
      tab: "trending",
      sort: "vol",
      desc: true,
      stock: ticker,
      cursor: null,
      watch: [],
      callerId: null,
    });
    return {
      ticker,
      tokenVolumeUsd: Math.round(stats[ticker].volumeUsd),
      tokens: stats[ticker].tokens,
      paired: page.rows.slice(0, 4).map((row) => row.asset),
      builtAt: Date.now(),
    };
  });
}
