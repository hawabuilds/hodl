"use client";

import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {publishPrices} from "@/lib/livePrice";
import {isPriced} from "@/lib/priceState";
import {applyCachedToken, rememberTokens} from "@/lib/tokenCache";
import {MARKET_REFRESH_MS} from "@/config/market";
import type {RwaAsset, TokenAsset} from "@/lib/types";
import type {MarketSort} from "@/app/api/market/route";

interface MarketResponse {
  rwas: RwaAsset[];
  tokens: TokenAsset[];
  seeded: boolean;
  /** When the server built these prices. Absent on an older cached payload. */
  asOf?: number;
}

export interface MarketFilters {
  minLiq?: number | null;
  maxLiq?: number | null;
  minMcap?: number | null;
  maxMcap?: number | null;
  minVol?: number | null;
  maxVol?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
}

/** The home feed — prices and market caps track DexScreener on this cadence. */
export function useMarket(sort: MarketSort = "volume", filters: MarketFilters = {}) {
  const minLiq = filters.minLiq ?? null;
  const maxLiq = filters.maxLiq ?? null;
  const minMcap = filters.minMcap ?? null;
  const maxMcap = filters.maxMcap ?? null;
  const minVol = filters.minVol ?? null;
  const maxVol = filters.maxVol ?? null;
  const minAge = filters.minAge ?? null;
  const maxAge = filters.maxAge ?? null;
  const query = useQuery({
    queryKey: ["market", sort, minLiq, maxLiq, minMcap, maxMcap, minVol, maxVol, minAge, maxAge],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: MARKET_REFRESH_MS,
    queryFn: async () => {
      const params = new URLSearchParams({sort});
      if (minLiq) params.set("minLiq", String(minLiq));
      if (maxLiq) params.set("maxLiq", String(maxLiq));
      if (minMcap) params.set("minMcap", String(minMcap));
      if (maxMcap) params.set("maxMcap", String(maxMcap));
      if (minVol) params.set("minVol", String(minVol));
      if (maxVol) params.set("maxVol", String(maxVol));
      if (minAge) params.set("minAge", String(minAge));
      if (maxAge) params.set("maxAge", String(maxAge));
      const res = await fetch(`/api/market?${params}`, {cache: "no-store"});
      if (!res.ok) throw new Error("Could not load the market.");
      const data = (await res.json()) as MarketResponse;

      // Publish into the shared price so feed rows and chart pages read one
      // number. Stamped with when the server built the payload, so a cached
      // snapshot cannot walk back over a fill the tape published a moment ago
      // just by being fetched after it.
      const at = data.asOf ?? Date.now();
      const entries: {id: string; price: number; at: number}[] = [];
      for (const asset of [...data.tokens, ...data.rwas]) {
        if (isPriced(asset.priceUsd)) {
          entries.push({id: asset.id, price: asset.priceUsd, at});
        }
      }
      publishPrices(entries);
      rememberTokens(data.tokens);

      return {
        ...data,
        tokens: data.tokens.map(applyCachedToken),
      };
    },
  });

  return {
    rwas: query.data?.rwas ?? [],
    tokens: (query.data?.tokens ?? []).map(applyCachedToken),
    seeded: query.data?.seeded ?? false,
    isLoading: query.isPending && !query.data,
    error: query.error as Error | null,
  };
}
