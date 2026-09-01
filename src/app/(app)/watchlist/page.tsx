"use client";

import {useMemo, useState} from "react";
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {AssetCard} from "@/components/AssetCard";
import {StarIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import {useWatchlist} from "@/hooks/useWatchlist";
import type {Asset} from "@/lib/types";

type Filter = "all" | "rwa" | "token";

export default function WatchlistPage() {
  const {keys} = useWatchlist();
  const [filter, setFilter] = useState<Filter>("all");

  // Sorted so the query key is stable: the same set in a different order should
  // not look like a new request.
  const ids = useMemo(() => [...keys].sort(), [keys]);

  const query = useQuery({
    queryKey: ["watchlist-assets", ids],
    enabled: ids.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/assets?ids=${encodeURIComponent(ids.join(","))}`);
      if (!res.ok) throw new Error("Could not load your watchlist.");
      return (await res.json()) as {assets: Asset[]};
    },
  });

  const assets = query.data?.assets ?? [];
  const showing = assets.filter(
    (asset) => filter === "all" || asset.kind === filter,
  );

  return (
    <div>
      <h1 className="mx-0.5 mb-3.5 mt-0.5 text-[24px] font-extrabold tracking-[-0.03em]">
        Watchlist
      </h1>

      {ids.length === 0 ? (
        <EmptyWatchlist />
      ) : (
        <>
          <div className="mb-3 flex gap-0.5 rounded-[12px] border border-hairline bg-wash p-[3px]">
            {(
              [
                {value: "all", label: "All"},
                {value: "token", label: "Tokens"},
                {value: "rwa", label: "RWAs"},
              ] as const
            ).map((option) => {
              const active = option.value === filter;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    "flex-1 rounded-[9px] py-2 text-[13px] font-extrabold transition-all duration-150",
                    active
                      ? "bg-card text-ink shadow-[0_2px_6px_-3px_rgba(9,24,14,0.3)]"
                      : "text-faint",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {query.isLoading ? (
            <div className="flex flex-col gap-2.5">
              {ids.map((id) => (
                <div key={id} className="h-[76px] animate-pulse rounded-card bg-wash" />
              ))}
            </div>
          ) : showing.length === 0 ? (
            <p className="py-8 text-center text-[13.5px] text-muted">
              Nothing on this side of your watchlist yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {showing.map((asset) => (
                <li key={`${asset.kind}:${asset.id}`}>
                  <AssetCard asset={asset} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EmptyWatchlist() {
  return (
    <div className="rounded-panel border border-hairline bg-card px-6 py-10 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
        <StarIcon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-[14px] font-bold">Nothing watched yet</p>
      <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-[1.5] text-muted">
        Tap the star next to any ticker or token to keep it here.
      </p>
      <Link
        href="/home"
        className="mt-5 inline-block rounded-pill bg-btn-dark px-4 py-2.5 text-[13px] font-bold text-btn-dark-fg"
      >
        Browse trending
      </Link>
    </div>
  );
}
