"use client";

import {useMemo, useRef} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import type {
  Asset,
  AssetKind,
  ChartPoint,
  NewsItem,
  Timeframe,
  Trade,
} from "@/lib/types";
import {MARKET_REFRESH_MS} from "@/config/market";
import {compareTradesNewestFirst} from "@/lib/tradeOrder";

const TAPE_LIMIT = 300;

/** Server spine plus chain-head fills the indexer has not indexed yet. */
function mergeTape(tape: Map<string, Trade>, incoming: Trade[]): Trade[] {
  const next = new Map<string, Trade>();
  for (const trade of incoming) {
    next.set(trade.id.toLowerCase(), trade);
  }

  if (incoming.length > 0) {
    const headAt = Date.parse(incoming[0].at);
    for (const [id, trade] of tape) {
      if (next.has(id)) continue;
      // Keep chain-only rows until the indexer catches up (~15s).
      if (Date.parse(trade.at) >= headAt - 15_000) {
        next.set(id, trade);
      }
    }
  }

  tape.clear();
  for (const [id, trade] of next) tape.set(id, trade);

  return [...tape.values()]
    .sort(compareTradesNewestFirst)
    .slice(0, TAPE_LIMIT);
}

export function useAsset(kind: AssetKind, id: string) {
  const query = useQuery({
    queryKey: ["asset", kind, id],
    staleTime: 0,
    refetchInterval: MARKET_REFRESH_MS,
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${id}`, {cache: "no-store"});
      if (!res.ok) throw new Error("Could not load this asset.");
      return (await res.json()) as {asset: Asset; seeded: boolean};
    },
  });

  return {
    asset: query.data?.asset ?? null,
    seeded: query.data?.seeded ?? false,
    isLoading: query.isPending && !query.data,
    error: query.error as Error | null,
  };
}

export function useChart(kind: AssetKind, id: string, timeframe: Timeframe) {
  const query = useQuery({
    queryKey: ["chart", kind, id, timeframe],
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${id}/chart?tf=${timeframe}`);
      if (!res.ok) throw new Error("Could not load the chart.");
      return (await res.json()) as {points: ChartPoint[]; changePct: number};
    },
  });

  return {
    points: query.data?.points ?? [],
    changePct: query.data?.changePct ?? null,
    isLoading: query.isPending && !query.data,
  };
}

export function useTrades(kind: AssetKind, id: string, enabled: boolean) {
  const scope = `${kind}:${id}`;
  const tapeRef = useRef<Map<string, Trade>>(new Map());
  const scopeRef = useRef(scope);

  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    tapeRef.current = new Map();
  }

  const query = useQuery({
    queryKey: ["trades", kind, id],
    enabled,
    staleTime: 0,
    refetchInterval: (q) => q.state.data?.pollMs ?? 2_000,
    structuralSharing: false,
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${id}/trades`);
      if (!res.ok) throw new Error("Could not load recent trades.");
      return (await res.json()) as {trades: Trade[]; pollMs?: number};
    },
  });

  const trades = useMemo(() => {
    const incoming = query.data?.trades ?? [];
    return mergeTape(tapeRef.current, incoming);
  }, [query.data?.trades]);

  return {
    trades,
    isLoading: query.isPending && tapeRef.current.size === 0,
  };
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
