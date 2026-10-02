"use client";

import {useQuery} from "@tanstack/react-query";
import {rememberTokens} from "@/lib/tokenCache";
import type {TokenAsset} from "@/lib/types";

/** Home's featured RWA, decided on the server (see server/homeFeatured.ts). */
export interface HomeFeaturedResponse {
  ticker: string | null;
  tokenVolumeUsd: number;
  tokens: number;
  paired: TokenAsset[];
  builtAt: number;
}

export const HOME_FEATURED_KEY = ["home-featured"] as const;

export function acceptHomeFeatured(body: HomeFeaturedResponse): HomeFeaturedResponse {
  rememberTokens(body.paired);
  return body;
}

export function useHomeFeatured() {
  return useQuery({
    queryKey: HOME_FEATURED_KEY,
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
    queryFn: async (): Promise<HomeFeaturedResponse> => {
      const res = await fetch("/api/home/featured");
      if (!res.ok) throw new Error("Couldn't load the featured RWA.");
      return acceptHomeFeatured((await res.json()) as HomeFeaturedResponse);
    },
  });
}
