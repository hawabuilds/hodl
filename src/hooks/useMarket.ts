"use client";

import {useQuery} from "@tanstack/react-query";
import type {RwaAsset, TokenAsset} from "@/lib/types";
import type {MarketSort} from "@/app/api/market/route";

interface MarketResponse {
  rwas: RwaAsset[];
  tokens: TokenAsset[];
  seeded: boolean;
}

/**
 * The home feed. Refetched on a minute, which is the cadence the market itself
 * moves on — anything faster only redraws the same numbers.
 */
export function useMarket(sort: MarketSort = "volume") {
  const query = useQuery({
    queryKey: ["market", sort],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/market?sort=${sort}`);
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
