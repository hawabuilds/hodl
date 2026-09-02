"use client";

import {keepPreviousData, useQuery} from "@tanstack/react-query";
import type {
  Asset,
  AssetKind,
  ChartPoint,
  NewsItem,
  Timeframe,
  Trade,
} from "@/lib/types";

export function useAsset(kind: AssetKind, id: string) {
  const query = useQuery({
    queryKey: ["asset", kind, id],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${id}`);
      if (!res.ok) throw new Error("Could not load this asset.");
      return (await res.json()) as {asset: Asset; seeded: boolean};
    },
  });

  return {
    asset: query.data?.asset ?? null,
    seeded: query.data?.seeded ?? false,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}

export function useChart(kind: AssetKind, id: string, timeframe: Timeframe) {
  const query = useQuery({
    queryKey: ["chart", kind, id, timeframe],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${id}/chart?tf=${timeframe}`);
      if (!res.ok) throw new Error("Could not load the chart.");
      return (await res.json()) as {points: ChartPoint[]; changePct: number};
    },
  });

  return {
    points: query.data?.points ?? [],
    changePct: query.data?.changePct ?? null,
    isLoading: query.isLoading,
  };
}

export function useTrades(kind: AssetKind, id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["trades", kind, id],
    enabled,
    // Paced by the server, which knows the upstream plan. Asking faster than
    // its cache window only re-serves the same rows.
    refetchInterval: (query) => query.state.data?.pollMs ?? 12_000,
    // Refetching pauses while the tab is hidden, which is the default and is
    // left alone deliberately — a backgrounded page has nobody watching.
    // New fills should slide in under the existing ones rather than blanking
    // the panel on every poll.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${id}/trades`);
      if (!res.ok) throw new Error("Could not load recent trades.");
      return (await res.json()) as {trades: Trade[]; pollMs?: number};
    },
  });

  return {trades: query.data?.trades ?? [], isLoading: query.isLoading};
}

export function useNews(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["news", id],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/asset/rwa/${id}/news`);
      if (!res.ok) throw new Error("Could not load news.");
      return (await res.json()) as {items: NewsItem[]; seeded: boolean};
    },
  });

  return {
    items: query.data?.items ?? [],
    seeded: query.data?.seeded ?? false,
    isLoading: query.isLoading,
  };
}
