import {unstable_cache} from "next/cache";
import type {NextRequest} from "next/server";
import {json} from "@/lib/server/http";
import {fetchRwas, fetchTokens} from "@/lib/server/sources";
import type {Asset} from "@/lib/types";

export const dynamic = "force-dynamic";

export type MarketSort = "volume" | "marketCap" | "change" | "new";

function sorted(assets: Asset[], sort: MarketSort): Asset[] {
  const copy = [...assets];
  switch (sort) {
    case "marketCap":
      return copy.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
    case "change":
      return copy.sort((a, b) => b.changePct - a.changePct);
    case "new":
      return copy.sort((a, b) => {
        const at = a.kind === "token" ? Date.parse(a.createdAt) : 0;
        const bt = b.kind === "token" ? Date.parse(b.createdAt) : 0;
        return bt - at;
      });
    default:
      return copy.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  }
}

/** Busiest tokens, for every view that ranks by size. */
const BY_VOLUME = 300;

/** Newest graduations, for the feed's New tab. */
const BY_AGE = 250;

/**
 * What the feed carries.
 *
 * Enumerating every stock token's pools turned up around a thousand tokens,
 * which is the right number to know about and the wrong number to send: a
 * megabyte on every refresh, most of it rows nobody scrolls to.
 *
 * So the response is the union of the two orderings the feed actually offers —
 * the busiest, and the most recently launched. Trimming by volume alone would
 * have cut exactly the tokens the New tab exists to show, since a pool minutes
 * old has no volume yet.
 */
function trimmed(tokens: Asset[]): Asset[] {
  const busiest = [...tokens]
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, BY_VOLUME);

  const newest = [...tokens]
    .filter(
      (asset) =>
        asset.kind === "token" && asset.launchpad !== null && asset.graduated,
    )
    .sort((a, b) => {
      const at = a.kind === "token" ? Date.parse(a.createdAt) : 0;
      const bt = b.kind === "token" ? Date.parse(b.createdAt) : 0;
      return bt - at;
    })
    .slice(0, BY_AGE);

  const keep = new Map<string, Asset>();
  for (const asset of [...busiest, ...newest]) keep.set(asset.id, asset);
  return [...keep.values()];
}

/**
 * The home feed.
 *
 * Both sides are returned in one response rather than one call per tab: the
 * filter is a client-side toggle, and refetching the list every time someone
 * flips between Tokens and RWAs would make the toggle feel slow.
 */
/**
 * The feed, cached where every instance can see it.
 *
 * The in-process cache each source keeps is per lambda, and a serverless
 * deployment runs many. In production that showed as a feed whose size changed
 * with whichever instance answered — 60 tokens on a cold one, 353 on a warm
 * one, and a New tab that came back empty on one request and full on the next.
 *
 * This is the one place that has to be consistent, so the built payload goes
 * through the shared data cache: the first request populates it, everyone else
 * reads the same thing, and it revalidates behind them.
 */
const feed = unstable_cache(
  async () => {
    const [rwas, tokens] = await Promise.all([fetchRwas(), fetchTokens()]);
    return {
      rwas: rwas.data,
      tokens: trimmed(tokens.data),
      seeded: rwas.seeded || tokens.seeded,
    };
  },
  ["market-feed"],
  {revalidate: 60},
);

export async function GET(request: NextRequest) {
  const sort = (request.nextUrl.searchParams.get("sort") ??
    "volume") as MarketSort;

  const {rwas, tokens, seeded} = await feed();

  // Sorted per request rather than per cache entry, so the four orderings share
  // one build instead of holding four copies of the same rows.
  return json({
    rwas: sorted(rwas, sort),
    tokens: sorted(tokens, sort),
    seeded,
  });
}
