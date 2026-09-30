"use client";

import {useMemo} from "react";
import {usePathname} from "next/navigation";

import {AssetList} from "../AssetRow";
import {useActivity, useAlertPrefs} from "@/hooks/useActivity";
import {useMarket} from "@/hooks/useMarket";
import {useNewTokens, type NewTokenFilters} from "@/hooks/useNewTokens";
import {useWatchlist, useWatchlistAssets} from "@/hooks/useWatchlist";
import {unreadFollowing} from "@/lib/alerts";
import {setRailList, useRailList, type RailList} from "@/lib/alertBus";
import {sortTokens} from "@/lib/feedSorts";
import {BoardColumn, ColumnNote, ColumnSegments} from "./BoardColumn";
import {FollowingFeed} from "./FollowingFeed";
import {UnreadCount} from "./UnreadCount";

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
 * chosen. Following reads the activity query the shell keeps polling for the
 * bell and the pop-ups, which is also what keeps its count current while
 * another list is showing.
 */

const LISTS: readonly {value: RailList; label: string}[] = [
  {value: "trending", label: "Trending"},
  {value: "new", label: "New"},
  {value: "following", label: "Following"},
  {value: "watchlist", label: "Watchlist"},
];

/** Stable, so the New feed keeps one query key rather than a fresh one per render. */
const ALL_LAUNCHPADS: NewTokenFilters = {};

export function ListRail() {
  const pathname = usePathname() ?? "";
  const list = useRailList();
  const {activity} = useActivity();
  const {prefs} = useAlertPrefs();
  // Opening the tab reads it, so the count only shows while it is closed.
  const unread = activity && list !== "following" ? unreadFollowing(activity, prefs) : 0;
  const options = LISTS.map((option) =>
    option.value === "following"
      ? {...option, badge: <UnreadCount count={unread} target="following" />}
      : option,
  );

  const market = useMarket("trending");
  const trending = useMemo(() => sortTokens(market.tokens, "trending"), [market.tokens]);
  const fresh = useNewTokens(ALL_LAUNCHPADS, list === "new");
  const {count: watchCount} = useWatchlist();
  const watchlist = useWatchlistAssets(list === "watchlist" && watchCount > 0);

  const shown =
    list === "trending" ? trending : list === "new" ? fresh.tokens : watchlist.assets;

  const empty =
    list === "watchlist" && watchCount === 0
      ? "Star a token or RWA and it pins here."
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
          <ColumnSegments label="List" options={options} value={list} onChange={setRailList} />
        }
      >
        {list === "following" ? (
          <FollowingFeed />
        ) : shown.length > 0 ? (
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
