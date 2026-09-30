"use client";

import {useMemo, useState} from "react";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {AssetList} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {PersonRow} from "@/components/PersonRow";
import {SectionLabel} from "@/components/ui/Card";
import {SearchBar} from "@/components/ui/SearchBar";
import {SearchIcon} from "@/components/ui/Icons";
import {useMarket} from "@/hooks/useMarket";
import {useSearch} from "@/hooks/useSearch";
import {applyCachedAssets} from "@/lib/tokenCache";
import type {Asset} from "@/lib/types";

type Scope = "all" | "token" | "rwa" | "people";

const SCOPES: FilterOption<Scope>[] = [
  {value: "all", label: "All"},
  {value: "rwa", label: "RWAs"},
  {value: "token", label: "Tokens"},
  {value: "people", label: "People"},
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const {search, trimmed, active} = useSearch(query);

  // Only loaded to fill the empty state, so it is never in the way of a query.
  const market = useMarket();

  const assets = useMemo(() => {
    const found = applyCachedAssets(search.data?.results ?? []);
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
    <div className={APP_SCROLL_PAD_TOP}>
      <SearchBar
        value={query}
        onChange={setQuery}
        label="Search tokens, RWAs and people"
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
            {search.data?.ineligible
              ? "Not eligible for HODL"
              : `Nothing matches “${trimmed}”`}
          </p>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-[1.5] text-muted">
            {search.data?.ineligible
              ? "That contract exists, but it is not a Pons or Long token paired against an RWA or paying holders in one."
              : "Try a ticker, a token symbol, a contract address or a handle."}
          </p>
        </div>
      ) : (
        <>
          {(search.data?.rwas ?? assets.filter((asset) => asset.kind === "rwa")).length > 0 &&
          scope !== "token" &&
          scope !== "people" ? (
            <>
              <SectionLabel>RWAS</SectionLabel>
              <AssetList
                assets={search.data?.rwas ?? assets.filter((asset) => asset.kind === "rwa")}
              />
            </>
          ) : null}

          {(search.data?.tokens ?? assets.filter((asset) => asset.kind === "token")).length > 0 &&
          scope !== "rwa" &&
          scope !== "people" ? (
            <>
              <SectionLabel>TOKENS</SectionLabel>
              <AssetList
                assets={applyCachedAssets(
                  search.data?.tokens ??
                    assets.filter((asset) => asset.kind === "token"),
                )}
              />
            </>
          ) : null}

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
        </>
      )}
    </div>
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
