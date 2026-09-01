"use client";

import {useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {AssetList} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {Avatar} from "@/components/ui/Avatar";
import {SectionLabel} from "@/components/ui/Card";
import {SearchBar} from "@/components/ui/SearchBar";
import {SearchIcon} from "@/components/ui/Icons";
import {useMarket} from "@/hooks/useMarket";
import {compact, compactMoney} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import type {Asset, Profile} from "@/lib/types";

type Scope = "all" | "token" | "rwa" | "people";

const SCOPES: FilterOption<Scope>[] = [
  {value: "all", label: "All"},
  {value: "rwa", label: "RWAs"},
  {value: "token", label: "Tokens"},
  {value: "people", label: "People"},
];

interface SearchResponse {
  results: Asset[];
  people: Profile[];
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<Scope>("all");

  // Debounced rather than fired per keystroke: a pasted address arrives as one
  // change, but a typed ticker arrives as four, and three of those responses
  // are answers nobody reads.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(id);
  }, [query]);

  const trimmed = debounced.trim();
  const active = trimmed.length > 0;

  const search = useQuery({
    queryKey: ["search-all", trimmed],
    enabled: active,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(
        `/api/search?people=1&q=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) throw new Error("Search failed.");
      return (await res.json()) as SearchResponse;
    },
  });

  // Only loaded to fill the empty state, so it is never in the way of a query.
  const market = useMarket();

  const assets = useMemo(() => {
    const found = search.data?.results ?? [];
    if (scope === "token" || scope === "rwa") {
      return found.filter((asset) => asset.kind === scope);
    }
    return scope === "people" ? [] : found;
  }, [search.data, scope]);

  const people = useMemo(() => {
    if (scope === "token" || scope === "rwa") return [];
    return search.data?.people ?? [];
  }, [search.data, scope]);

  const nothing = active && !search.isLoading && assets.length === 0 && people.length === 0;

  return (
    <div>
      <SearchBar
        value={query}
        onChange={setQuery}
        label="Search people, stocks and tokens"
        placeholder="People, tickers, tokens, addresses"
        className="mb-3.5"
      />

      {active ? (
        <FilterRail
          label="Filter results"
          options={SCOPES}
          value={scope}
          onChange={setScope}
          className="mb-1"
        />
      ) : null}

      {!active ? (
        <Discover
          assets={[...market.rwas.slice(0, 4), ...market.tokens.slice(0, 4)]}
          loading={market.isLoading}
        />
      ) : nothing ? (
        <div className="px-6 py-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
            <SearchIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[14px] font-bold">
            Nothing matches “{trimmed}”
          </p>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-[1.5] text-muted">
            Try a ticker, a token symbol, a contract address or a handle.
          </p>
        </div>
      ) : (
        <>
          {people.length > 0 ? (
            <>
              <SectionLabel>PEOPLE</SectionLabel>
              <ul className="-mx-[22px]">
                {people.map((person) => (
                  <PersonRow key={person.handle} person={person} />
                ))}
              </ul>
            </>
          ) : null}

          {assets.length > 0 ? (
            <>
              {people.length > 0 ? <SectionLabel>MARKETS</SectionLabel> : null}
              <AssetList assets={assets} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function PersonRow({person}: {person: Profile}) {
  const value = person.holdings.reduce((sum, h) => sum + h.valueUsd, 0);

  return (
    <li>
      <Link
        href={profilePath(person.handle)}
        className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
      >
        <Avatar name={person.displayName} src={person.pfpUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-extrabold tracking-[-0.015em]">
            {person.displayName}
          </div>
          <div className="truncate text-[12.5px] font-semibold text-faint">
            @{person.handle}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[13.5px] font-extrabold tracking-[-0.015em]">
            {compactMoney(value)}
          </div>
          <div className="tnum text-[11.5px] font-semibold text-faint">
            {compact(person.followers)} followers
          </div>
        </div>
      </Link>
    </li>
  );
}

/** What the tab shows before anyone types: the largest names on both sides. */
function Discover({assets, loading}: {assets: Asset[]; loading: boolean}) {
  if (loading) {
    return (
      <div className="-mx-[22px]">
        {Array.from({length: 6}).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-[22px] py-[15px]">
            <div className="h-10 w-10 animate-pulse rounded-full bg-wash" />
            <div className="flex-1">
              <div className="h-3.5 w-20 animate-pulse rounded bg-wash" />
              <div className="mt-2 h-3 w-14 animate-pulse rounded bg-wash" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <SectionLabel className="mt-1">TRENDING</SectionLabel>
      <AssetList assets={assets} />
    </>
  );
}
