"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {
  Asset,
  AssetKind,
  ChartPoint,
  NewsItem,
  Timeframe,
  Trade,
} from "@/lib/types";
import {MARKET_REFRESH_MS} from "@/config/market";
import {mergeChartPoints} from "@/lib/chartLwc";
import {normalizeAddress} from "@/lib/address";
import {compareTradesNewestFirst} from "@/lib/tradeOrder";
import {applyCachedToken, rememberTokens, tokenFor} from "@/lib/tokenCache";
import {fromAssetBundle} from "./assetBundle";

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
  const key = kind === "token" ? normalizeAddress(id) : id;
  const query = useQuery({
    queryKey: ["asset", kind, key],
    staleTime: 60_000,
    placeholderData: (previous) => {
      if (previous) return previous;
      if (kind !== "token") return undefined;
      const cached = tokenFor(key);
      return cached ? {asset: cached, seeded: false} : undefined;
    },
    refetchInterval: MARKET_REFRESH_MS,
    queryFn: async () => {
      const bundle = await fromAssetBundle(kind, key);
      if (bundle?.asset) {
        if (bundle.asset.kind === "token") rememberTokens([bundle.asset]);
        return {asset: bundle.asset, seeded: bundle.seeded};
      }
      const res = await fetch(`/api/asset/${kind}/${key}`, {cache: "no-store"});
      if (!res.ok) throw new Error("Could not load this asset.");
      const data = (await res.json()) as {asset: Asset; seeded: boolean};
      if (data.asset?.kind === "token") rememberTokens([data.asset]);
      return data;
    },
  });

  const raw = query.data?.asset ?? null;
  const asset =
    raw?.kind === "token" ? applyCachedToken(raw) : raw;

  return {
    asset,
    seeded: query.data?.seeded ?? false,
    isLoading: query.isPending && !query.data,
    error: query.error as Error | null,
  };
}

interface ChartResponse {
  points: ChartPoint[];
  changePct: number;
  timeframe?: Timeframe;
  resolvedTimeframe?: Timeframe;
  error?: string | null;
}

async function fetchChart(
  kind: AssetKind,
  key: string,
  timeframe: Timeframe,
  signal?: AbortSignal,
): Promise<ChartResponse> {
  const bundle = await fromAssetBundle(kind, key, timeframe);
  if (bundle?.chart) {
    return {...bundle.chart, resolvedTimeframe: bundle.chart.resolvedTimeframe ?? timeframe};
  }
  const res = await fetch(`/api/asset/${kind}/${key}/chart?tf=${timeframe}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error("Could not load the chart.");
  return (await res.json()) as ChartResponse;
}

export function useChart(kind: AssetKind, id: string, timeframe: Timeframe, enabled = true) {
  const key = kind === "token" ? normalizeAddress(id) : id;
  const scope = `${kind}:${key}:${timeframe}`;
  const [older, setOlder] = useState<ChartPoint[]>([]);
  const [hasMore, setHasMore] = useState(kind === "token");
  const loadingOlder = useRef(false);

  useEffect(() => {
    setOlder([]);
    setHasMore(kind === "token");
    loadingOlder.current = false;
  }, [scope, kind]);

  const query = useQuery<ChartResponse>({
    queryKey: ["chart", kind, key, timeframe],
    enabled,
    refetchInterval: 60_000,
    // A new timeframe keeps the last one on screen until its own data lands,
    // like Trador. Only for the same asset: another token's chart standing in
    // for this one would be wrong, not just stale.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === kind && previousQuery?.queryKey[2] === key
        ? previous
        : undefined,
    // A timeframe tapped past is cancelled (React Query aborts a query left
    // with no viewer), and each timeframe is its own cache entry, so a slow
    // answer for an older pick can never replace the newest one — and a
    // timeframe already seen comes back from cache at once.
    queryFn: ({signal}): Promise<ChartResponse> => fetchChart(kind, key, timeframe, signal),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    retry: false,
  });

  const tip = query.data?.points;
  const points = useMemo(() => mergeChartPoints(older, tip ?? []), [older, tip]);

  const loadOlder = useCallback(async () => {
    if (kind !== "token" || !hasMore || loadingOlder.current) return;
    const first = points[0]?.t;
    if (first == null) return;
    loadingOlder.current = true;
    try {
      const res = await fetch(
        `/api/asset/${kind}/${key}/chart?tf=${timeframe}&before=${first}`,
        {cache: "no-store"},
      );
      if (!res.ok) {
        setHasMore(false);
        return;
      }
      const data = (await res.json()) as {points?: ChartPoint[]};
      const incoming = (data.points ?? []).filter((point) => point.t < first);
      if (incoming.length === 0) {
        setHasMore(false);
        return;
      }
      setOlder((current) => mergeChartPoints(incoming, current));
    } catch {
      setHasMore(false);
    } finally {
      loadingOlder.current = false;
    }
  }, [kind, key, timeframe, hasMore, points]);

  return {
    points,
    changePct: query.data?.changePct ?? null,
    resolvedTimeframe: query.data?.resolvedTimeframe ?? timeframe,
    isLoading: query.isPending && !query.data,
    /** Showing the previous timeframe while this one loads. */
    isSwitching: query.isPlaceholderData,
    hasMore,
    loadOlder,
    error:
      query.error?.message ??
      (query.data?.error && (query.data.points?.length ?? 0) < 2
        ? query.data.error
        : null),
    retry: () => void query.refetch(),
  };
}

export function useTrades(kind: AssetKind, id: string, enabled: boolean) {
  const key = kind === "token" ? normalizeAddress(id) : id;
  const scope = `${kind}:${key}`;
  const tapeRef = useRef<Map<string, Trade>>(new Map());
  const scopeRef = useRef(scope);

  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    tapeRef.current = new Map();
  }

  const query = useQuery({
    queryKey: ["trades", kind, key],
    enabled,
    staleTime: 0,
    refetchInterval: (q) => q.state.data?.pollMs ?? 2_000,
    structuralSharing: false,
    queryFn: async () => {
      const bundle = await fromAssetBundle(kind, key);
      if (bundle?.trades) return bundle.trades;
      const res = await fetch(`/api/asset/${kind}/${key}/trades`);
      if (!res.ok) throw new Error("Could not load recent trades.");
      return (await res.json()) as {
        trades: Trade[];
        pollMs?: number;
        error?: string | null;
        liveDown?: boolean;
      };
    },
    retry: false,
  });

  const trades = useMemo(() => {
    const incoming = query.data?.trades ?? [];
    return mergeTape(tapeRef.current, incoming);
  }, [query.data?.trades]);

  return {
    trades,
    isLoading: query.isPending && tapeRef.current.size === 0,
    error:
      query.error?.message ??
      (trades.length === 0 ? query.data?.error ?? null : null),
    // The chain read behind the newest fills failed, so the tape is the
    // indexer's alone and can run minutes behind. Shown, not swallowed.
    liveDown: query.data?.liveDown ?? false,
    retry: () => void query.refetch(),
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
      return (await res.json()) as {
        items: NewsItem[];
        seeded: boolean;
        error?: string | null;
      };
    },
    retry: false,
  });

  return {
    items: query.data?.items ?? [],
    seeded: query.data?.seeded ?? false,
    isLoading: query.isLoading,
    error:
      query.error?.message ??
      (query.data?.items?.length ? null : query.data?.error ?? null),
    retry: () => void query.refetch(),
  };
}

/**
 * Hourly bars for the header's 24h change, whatever timeframe is on screen.
 *
 * The same query as the 1h chart, so on 1h — the default, and what a row
 * hover prefetches — it costs nothing. The market's own 24h figure can be a
 * stale snapshot: a token flat for two weeks still read "▼99% 24h" from the
 * day it crashed.
 */
export function useHourlyReference(kind: AssetKind, id: string) {
  const key = kind === "token" ? normalizeAddress(id) : id;
  const query = useQuery({
    queryKey: ["chart", kind, key, "1h"],
    refetchInterval: 60_000,
    queryFn: () => fetchChart(kind, key, "1h"),
    retry: false,
  });
  return query.data?.resolvedTimeframe === "1h" || query.data?.resolvedTimeframe == null
    ? (query.data?.points ?? null)
    : null;
}
