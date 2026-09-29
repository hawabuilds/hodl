"use client";

import {usePathname} from "next/navigation";

import {useEthPrice} from "@/hooks/useEthPrice";
import {useWatchlist} from "@/hooks/useWatchlist";
import {LiveDot} from "./BoardColumn";

/**
 * The terminal's bottom line: which chain, what ETH is doing, and one hint.
 *
 * The dot is only green once a live price has actually arrived. A status light
 * that is green by default says "connected" on a page that has not heard from
 * anything yet.
 */
export function StatusBar() {
  const pathname = usePathname() ?? "";
  const {ethUsd} = useEthPrice();
  const {count: watchCount} = useWatchlist();

  // The watchlist column appears only once something is pinned, so on the
  // board this is where a new user learns it exists.
  const hint =
    pathname === "/home" && watchCount === 0
      ? "☆ Star a token or stock to add a Watchlist column"
      : "Press / to search";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-[18px] border-t border-[var(--overlay-wash)] bg-surface-base px-[18px] text-[11.5px] font-semibold text-faint">
      <span className="flex items-center gap-[7px] text-muted">
        {ethUsd ? (
          <LiveDot />
        ) : (
          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[var(--overlay-wash-hover)]" />
        )}
        Robinhood Chain
      </span>
      {ethUsd ? (
        <span className="tabular-nums">
          ETH ${ethUsd.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}
        </span>
      ) : null}
      <span className="ml-auto">{hint}</span>
    </footer>
  );
}
