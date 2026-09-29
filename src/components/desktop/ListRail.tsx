"use client";

import {useMemo, useState} from "react";
import {usePathname} from "next/navigation";

import {AssetList} from "../AssetRow";
import {useMarket} from "@/hooks/useMarket";
import {useNewTokens, type NewTokenFilters} from "@/hooks/useNewTokens";
import {useWatchlist, useWatchlistAssets} from "@/hooks/useWatchlist";
import {sortTokens} from "@/lib/feedSorts";
import {BoardColumn, ColumnNote, ColumnSegments} from "./BoardColumn";

/**
 * The list beside a token page, so the next token is one click away.
 *
 * It lives in the shell rather than the page, which is what makes it useful:
 * clicking from one token to the next swaps the chart and the ticket but leaves
 * this alone — same list, same scroll position, same tab. A rail that remounted
 * on every click would throw you back to the top each time.
 *
 * A phone gives a feed row 346px of content, and that is what a long symbol
 * with a pair chip — STRATEGY · MSTR — needs to read in full. 380px leaves the
 * rail that much after its padding, so it only appears from 1280px up. Between 1024 and 1280 there is room for the chart and
 * the ticket but not for a third pane, and a list whose symbols collapse to a
 * single letter is worse than no list — the top bar still gets you to Discover.
 *
 * Only the visible list polls. Trending is the market query every screen
 * already shares, so it costs nothing extra; New and Watchlist wake only when
 * chosen.
 */

const LISTS = [
  {value: "trending", label: "Trending"},
  {value: "new", label: "New"},
  {value: "watchlist", label: "Watchlist"},
] as const;

type List = (typeof LISTS)[number]["value"];

/** Stable, so the New feed keeps one query key rather than a fresh one per render. */
const ALL_LAUNCHPADS: NewTokenFilters = {};

export function ListRail() {
  const pathname = usePathname() ?? "";
  const [list, setList] = useState<List>("trending");

  const market = useMarket("trending");
  const trending = useMemo(() => sortTokens(market.tokens, "trending"), [market.tokens]);
  const fresh = useNewTokens(ALL_LAUNCHPADS, list === "new");
  const {count: watchCount} = useWatchlist();
  const watchlist = useWatchlistAssets(list === "watchlist" && watchCount > 0);

  const shown =
    list === "trending" ? trending : list === "new" ? fresh.tokens : watchlist.assets;

  const empty =
    list === "watchlist" && watchCount === 0
      ? "Star a token or stock and it pins here."
      : list === "new"
        ? fresh.isLoading
          ? "Loading new pairs…"
          : "No new pairs yet."
        : list === "watchlist"
          ? "Loading your watchlist…"
          : market.isLoading
            ? "Loading tokens…"
            : "No tokens clear the bar right now.";

  return (
    <aside aria-label="Token lists" className="hidden w-[380px] shrink-0 p-2.5 pr-0 xl:flex">
      <BoardColumn
        className="w-full"
        // The segmented control already names the list; a title beside it
        // repeated the word and pushed the controls into truncating it.
        controls={
          <ColumnSegments label="List" options={LISTS} value={list} onChange={setList} />
        }
      >
        {shown.length > 0 ? (
          <AssetList
            assets={shown}
            flush
            dense
            activePath={pathname}
            markArrivals={list === "new"}
            chartTimeframe={list === "new" ? "1m" : undefined}
          />
        ) : (
          <ColumnNote>{empty}</ColumnNote>
        )}
      </BoardColumn>
    </aside>
  );
}
