"use client";

import {useMemo, useState} from "react";
import {AssetCard} from "@/components/AssetCard";
import {SectorRail} from "@/components/SectorRail";
import {SearchBar} from "@/components/ui/SearchBar";
import {cn} from "@/lib/cn";
import {useMarket} from "@/hooks/useMarket";
import {useSearch} from "@/hooks/useSearch";
import {SECTORS, type SectorId} from "@/lib/sectors";
import type {Asset} from "@/lib/types";
import type {MarketSort} from "@/app/api/market/route";

type Side = "tokens" | "rwas";

const SORTS: {value: MarketSort; label: string}[] = [
  {value: "volume", label: "Volume"},
  {value: "marketCap", label: "Cap"},
  {value: "change", label: "Movers"},
  {value: "new", label: "New"},
];

export default function HomePage() {
  const [side, setSide] = useState<Side>("tokens");
  const [sort, setSort] = useState<MarketSort>("volume");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<SectorId | null>(null);

  const market = useMarket(sort);
  const search = useSearch(query);

  const list: Asset[] = side === "tokens" ? market.tokens : market.rwas;

  // Sector chips only mean anything on the RWA side, and their counts come from
  // the list actually on screen.
  const sectorCounts = useMemo(() => {
    const counts = new Map<SectorId, number>();
    for (const asset of market.rwas) {
      counts.set(asset.sector, (counts.get(asset.sector) ?? 0) + 1);
    }
    return counts;
  }, [market.rwas]);

  const filtered = useMemo(() => {
    if (side !== "rwas" || !sector) return list;
    return list.filter((asset) => asset.kind === "rwa" && asset.sector === sector);
  }, [list, side, sector]);

  const showing = search.active ? search.results : filtered;

  return (
    <div>
      <h1 className="mx-0.5 mb-3.5 mt-0.5 text-[24px] font-extrabold tracking-[-0.03em]">
        Trending
      </h1>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Ticker, token or contract address"
        className="mb-3"
      />

      {search.active ? null : (
        <>
          <div className="mb-3 flex gap-0.5 rounded-[12px] border border-hairline bg-wash p-[3px]">
            {(
              [
                {value: "tokens", label: `Tokens ${market.tokens.length || ""}`},
                {value: "rwas", label: `RWAs ${market.rwas.length || ""}`},
              ] as const
            ).map((option) => {
              const active = option.value === side;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSide(option.value)}
                  className={cn(
                    "flex-1 rounded-[9px] py-2 text-[13px] font-extrabold transition-all duration-150",
                    active
                      ? "bg-card text-ink shadow-[0_2px_6px_-3px_rgba(9,24,14,0.3)]"
                      : "text-faint",
                  )}
                >
                  {option.label.trim()}
                </button>
              );
            })}
          </div>

          {side === "rwas" ? (
            <SectorRail
              counts={sectorCounts}
              total={market.rwas.length}
              value={sector}
              onChange={setSector}
            />
          ) : null}

          <div className="rail mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {SORTS.map((option) => {
              const active = option.value === sort;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSort(option.value)}
                  className={cn(
                    "shrink-0 rounded-pill px-3 py-1.5 text-[12px] font-bold transition-colors duration-150",
                    active
                      ? "bg-[rgba(0,200,5,0.12)] text-green-deep"
                      : "text-faint hover:text-muted",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {market.isLoading && !search.active ? (
        <FeedSkeleton />
      ) : market.error && !search.active ? (
        <p className="py-8 text-center text-[13.5px] text-muted">
          {market.error.message}
        </p>
      ) : showing.length === 0 ? (
        <EmptyFeed
          query={query}
          searching={search.active}
          loading={search.isLoading}
          sector={sector}
          onClearSector={() => setSector(null)}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {showing.map((asset) => (
            <li key={`${asset.kind}:${asset.id}`}>
              <AssetCard asset={asset} />
            </li>
          ))}
        </ul>
      )}

      {market.seeded && !market.isLoading ? (
        <p className="mt-6 px-0.5 text-[11.5px] leading-[1.5] text-faint">
          Seeded market data. Prices, pools and trades are simulated until the
          registry and pool indexer are connected.
        </p>
      ) : null}
    </div>
  );
}

function EmptyFeed({
  query,
  searching,
  loading,
  sector,
  onClearSector,
}: {
  query: string;
  searching: boolean;
  loading: boolean;
  sector: SectorId | null;
  onClearSector: () => void;
}) {
  if (searching) {
    return (
      <p className="py-8 text-center text-[13.5px] text-muted">
        {loading ? "Searching" : `Nothing matches “${query.trim()}”`}
      </p>
    );
  }

  return (
    <div className="py-8 text-center">
      <p className="text-[13.5px] text-muted">
        Nothing in{" "}
        {sector ? SECTORS.find((s) => s.id === sector)?.label : "this list"} right
        now.
      </p>
      {sector ? (
        <button
          type="button"
          onClick={onClearSector}
          className="mt-3 rounded-pill border border-hairline bg-card px-3.5 py-2 text-[12.5px] font-bold text-ink"
        >
          Show all sectors
        </button>
      ) : null}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({length: 7}).map((_, i) => (
        <div key={i} className="h-[76px] animate-pulse rounded-card bg-wash" />
      ))}
    </div>
  );
}
