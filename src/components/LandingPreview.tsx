"use client";

import type {MouseEvent} from "react";

import {AssetList} from "./AssetRow";
import {BoardColumn, ColumnNote} from "./desktop/BoardColumn";
import {useMarket} from "@/hooks/useMarket";
import {sortRwas, sortTokens} from "@/lib/feedSorts";

/**
 * The market, live, beside the landing pitch on a desktop.
 *
 * A phone's landing page is the pitch and nothing else, because that is all
 * the screen holds. A desktop has room to show what the pitch is about: what
 * is trending and which stocks are moving, right now. Every row is a way in —
 * picking one asks you to join, since the chart pages are behind sign-in.
 */
export function LandingPreview({onJoin}: {onJoin: () => void}) {
  const market = useMarket("trending");
  const tokens = sortTokens(market.tokens, "trending").slice(0, 6);
  const movers = sortRwas(market.rwas, "movers").slice(0, 6);

  const intercept = (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest("a[href]")) return;
    event.preventDefault();
    onJoin();
  };

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-16 rounded-full bg-[radial-gradient(closest-side,rgb(104_96_255/22%),transparent)]"
      />
      <div
        onClickCapture={intercept}
        className="relative rounded-[20px] border border-[var(--overlay-wash)] bg-[var(--frame-chrome)] p-2.5 shadow-modal"
      >
        <div className="flex items-baseline justify-between gap-3 px-2 pb-2.5 pt-1">
          <span className="text-[13px] font-extrabold tracking-[-0.01em]">
            Live on Robinhood Chain
          </span>
          {market.rwas.length > 0 ? (
            <span className="tabular-nums text-[11.5px] font-semibold text-faint">
              {market.rwas.length} tokenized stocks
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2.5 min-[1400px]:grid-cols-2">
          <BoardColumn title="Trending">
            {tokens.length > 0 ? (
              <AssetList assets={tokens} flush dense />
            ) : (
              <ColumnNote>{market.isLoading ? "Loading…" : "Nothing trending right now."}</ColumnNote>
            )}
          </BoardColumn>
          {/* Two lists need the width of a large window; below it the
              preview keeps to one rather than squeezing both. */}
          <BoardColumn title="Stock movers" className="hidden min-[1400px]:flex">
            {movers.length > 0 ? (
              <AssetList assets={movers} flush dense />
            ) : (
              <ColumnNote>{market.isLoading ? "Loading…" : "No prices yet."}</ColumnNote>
            )}
          </BoardColumn>
        </div>
      </div>
    </div>
  );
}
