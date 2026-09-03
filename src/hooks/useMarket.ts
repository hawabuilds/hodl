"use client";

import {useQuery} from "@tanstack/react-query";
import {MARKET_REFRESH_MS} from "@/config/market";
import type {RwaAsset, TokenAsset} from "@/lib/types";
import type {MarketSort} from "@/app/api/market/route";

interface MarketResponse {
  rwas: RwaAsset[];
  tokens: TokenAsset[];
  seeded: boolean;
}

/** The home feed — prices and market caps track DexScreener on this cadence. */
export function useMarket(sort: MarketSort = "volume") {
  const query = useQuery({
    queryKey: ["market", sort],
    staleTime: 0,
    refetchInterval: MARKET_REFRESH_MS,
    queryFn: async () => {
      const res = await fetch(`/api/market?sort=${sort}`, {cache: "no-store"});
      if (!res.ok) throw new Error("Could not load the market.");
      return (await res.json()) as MarketResponse;
    },
  });

  return {
    rwas: query.data?.rwas ?? [],
    tokens: query.data?.tokens ?? [],
    seeded: query.data?.seeded ?? false,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
