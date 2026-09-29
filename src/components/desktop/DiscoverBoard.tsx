"use client";

import {useMemo, useState} from "react";

import {AssetList} from "../AssetRow";
import {StarIcon} from "../ui/Icons";
import {useMarket} from "@/hooks/useMarket";
import {useNewTokens, type NewTokenFilters} from "@/hooks/useNewTokens";
import {useWatchlist, useWatchlistAssets} from "@/hooks/useWatchlist";
import {cn} from "@/lib/cn";
import {sortRwas, sortTokens, type RankedTokenSort} from "@/lib/feedSorts";
import type {RwaSort} from "@/lib/homeState";
import {BoardColumn, ColumnNote, ColumnSegments} from "./BoardColumn";

/**
 * Home, on a monitor: the lists side by side instead of behind tabs.
 *
 * Every column is the phone feed — the same rows, the same orderings from
 * `feedSorts`, the same hooks — laid out across instead of down. Nothing here
 * decides what a token is worth or where it ranks; it only decides where it
 * sits on the screen.
 *
 * The watchlist only takes a column once it has something in it. Empty, it was
 * a quarter of the screen saying "nothing pinned"; now the other three widen
 * into the space and the status bar carries the hint instead.
 */

const TOKEN_SORTS = [
  {value: "trending", label: "Trending"},
  {value: "marketCap", label: "Mkt cap"},
] as const satisfies readonly {value: RankedTokenSort; label: string}[];

const TOKEN_TITLES: Record<RankedTokenSort, string> = {
  trending: "Trending",
  marketCap: "Top market cap",
};

const LAUNCHPADS = [
  {value: "", label: "All"},
  {value: "pons", label: "Pons"},
  {value: "long", label: "Long"},
] as const satisfies readonly {value: NonNullable<NewTokenFilters["launchpad"]>; label: string}[];

const RWA_SORTS = [
  {value: "movers", label: "Movers"},
  {value: "marketCap", label: "Mkt cap"},
] as const satisfies readonly {value: RwaSort; label: string}[];

const WATCH_KINDS = [
  {value: "all", label: "All"},
  {value: "token", label: "Tokens"},
  {value: "rwa", label: "RWAs"},
] as const;

type WatchKind = (typeof WATCH_KINDS)[number]["value"];

export function DiscoverBoard() {
  const [tokenSort, setTokenSort] = useState<RankedTokenSort>("trending");
  const [launchpad, setLaunchpad] = useState<NonNullable<NewTokenFilters["launchpad"]>>("");
  const [rwaSort, setRwaSort] = useState<RwaSort>("movers");
  const [watchKind, setWatchKind] = useState<WatchKind>("all");

  // One market query serves the token column and the stock column, exactly as
  // it does on the phone.
  const market = useMarket(tokenSort);
  const tokens = useMemo(() => sortTokens(market.tokens, tokenSort), [market.tokens, tokenSort]);
  const rwas = useMemo(() => sortRwas(market.rwas, rwaSort), [market.rwas, rwaSort]);

  const newFilters = useMemo<NewTokenFilters>(() => ({launchpad}), [launchpad]);
  const fresh = useNewTokens(newFilters, true);

  // The count comes from local keys, so it is known before any asset loads —
  // deciding the column from the loaded list would flash three columns into four.
  const {count: watchCount} = useWatchlist();
  const watchlist = useWatchlistAssets(watchCount > 0);
  const watched = useMemo(
    () =>
      watchlist.assets.filter((asset) => watchKind === "all" || asset.kind === watchKind),
    [watchlist.assets, watchKind],
  );
  const showWatchlist = watchCount > 0;

  const marketError = market.error ? "Couldn't load the market. Retrying." : null;

  return (
    <div
      className={cn(
        // A feed row needs ~320px before its symbol starts collapsing. Three
        // columns clear that at 1024px; four do not until ~1330px, so below
        // that the board scrolls sideways rather than crushing every row.
        "grid h-full min-h-0 gap-2.5 overflow-x-auto p-2.5",
        showWatchlist
          ? "grid-cols-[repeat(4,minmax(320px,1fr))]"
          : "grid-cols-[repeat(3,minmax(320px,1fr))]",
      )}
    >
      <BoardColumn
        title={TOKEN_TITLES[tokenSort]}
        count={tokens.length}
        controls={
          <ColumnSegments
            label="Order tokens by"
            options={TOKEN_SORTS}
            value={tokenSort}
            onChange={setTokenSort}
          />
        }
      >
        {tokens.length > 0 ? (
          <AssetList assets={tokens} flush dense />
        ) : (
          <ColumnNote>
            {marketError ??
              (market.isLoading ? "Loading tokens…" : "No tokens clear the bar right now.")}
          </ColumnNote>
        )}
      </BoardColumn>

      <BoardColumn
        title="New pairs"
        count={fresh.tokens.length}
        controls={
          <ColumnSegments
            label="Launchpad"
            options={LAUNCHPADS}
            value={launchpad}
            onChange={setLaunchpad}
          />
        }
      >
        {fresh.tokens.length > 0 ? (
          <>
            {/* New rows open on the 1m chart, as they do on the phone. */}
            <AssetList assets={fresh.tokens} markArrivals chartTimeframe="1m" flush dense />
            {fresh.hasMore ? (
              <button
                type="button"
                onClick={() => void fresh.loadMore()}
                className="w-full py-3.5 text-[12.5px] font-bold text-faint transition-colors hover:text-accent-link"
              >
                Load more
              </button>
            ) : null}
          </>
        ) : (
          <ColumnNote>
            {fresh.error
              ? "Couldn't load new pairs. Retrying."
              : fresh.isLoading
                ? "Loading new pairs…"
                : "No new pairs yet."}
          </ColumnNote>
        )}
      </BoardColumn>

      <BoardColumn
        title="RWAs"
        count={rwas.length}
        controls={
          <ColumnSegments
            label="Order stocks by"
            options={RWA_SORTS}
            value={rwaSort}
            onChange={setRwaSort}
          />
        }
      >
        {rwas.length > 0 ? (
          <AssetList assets={rwas} flush dense />
        ) : (
          <ColumnNote>{marketError ?? "Loading stocks…"}</ColumnNote>
        )}
      </BoardColumn>

      {showWatchlist ? (
        <BoardColumn
          title={
            <span className="inline-flex items-center gap-1.5">
              <StarIcon className="h-[14px] w-[14px]" />
              Watchlist
            </span>
          }
          count={watchCount}
          controls={
            <ColumnSegments
              label="Show"
              options={WATCH_KINDS}
              value={watchKind}
              onChange={setWatchKind}
            />
          }
        >
          {watched.length > 0 ? (
            <AssetList assets={watched} flush dense />
          ) : (
            <ColumnNote>
              {watchlist.isLoading ? "Loading your watchlist…" : "Nothing of that kind pinned."}
            </ColumnNote>
          )}
        </BoardColumn>
      ) : null}
    </div>
  );
}
