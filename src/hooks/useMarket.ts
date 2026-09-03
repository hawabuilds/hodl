"use client";

import {useQuery} from "@tanstack/react-query";
import {publishPrices} from "@/lib/livePrice";
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

/** The home feed — prices and market caps track DexScreener on this cadence. */
export function useMarket(sort: MarketSort = "volume") {
  const query = useQuery({
    queryKey: ["market", sort],
    staleTime: 0,
    refetchInterval: MARKET_REFRESH_MS,
    queryFn: async () => {
      const res = await fetch(`/api/market?sort=${sort}`, {cache: "no-store"});
      if (!res.ok) throw new Error("Could not load the market.");
      const data = (await res.json()) as MarketResponse;

      // Publish into the shared price so feed rows and chart pages read one
      // number. Stamped with when the server built the payload, so a cached
      // snapshot cannot walk back over a fill the tape published a moment ago
      // just by being fetched after it.
      const at = data.asOf ?? Date.now();
      publishPrices(
        [...data.tokens, ...data.rwas].map((asset) => ({
          id: asset.id,
          price: asset.priceUsd,
          at,
        })),
      );

      return data;
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
