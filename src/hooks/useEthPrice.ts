"use client";

import {useQuery} from "@tanstack/react-query";

/** ETH in dollars. Refetched on the same minute cadence as the market. */
export function useEthPrice() {
  const query = useQuery({
    queryKey: ["eth-price"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/eth");
      if (!res.ok) throw new Error("Could not price ETH.");
      return (await res.json()) as {usd: number};
    },
  });

  return {ethUsd: query.data?.usd ?? null, isLoading: query.isLoading};
}
