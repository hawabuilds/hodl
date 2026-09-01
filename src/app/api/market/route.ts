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

/**
 * The home feed.
 *
 * Both sides are returned in one response rather than one call per tab: the
 * filter is a client-side toggle, and refetching a fifty-row list every time
 * someone flips between Tokens and RWAs would make the toggle feel slow.
 */
export async function GET(request: NextRequest) {
  const sort = (request.nextUrl.searchParams.get("sort") ??
    "volume") as MarketSort;

  const [rwas, tokens] = await Promise.all([fetchRwas(), fetchTokens()]);

  return json({
    rwas: sorted(rwas.data, sort),
    tokens: sorted(tokens.data, sort),
    seeded: rwas.seeded || tokens.seeded,
  });
}
