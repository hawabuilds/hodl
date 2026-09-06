"use client";

import {useCallback, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {normalizeAddress} from "@/lib/address";
import type {Asset, AssetKind, ChartPoint, Timeframe, Trade} from "@/lib/types";
import {rememberTokens} from "@/lib/tokenCache";

/**
 * Warms an asset's page before it is opened.
 *
 * One bundle request replaces three parallel routes that each used to rebuild
 * the full token list. The response is split into the same React Query keys
 * the chart page reads, so navigation finds everything already there.
 */
export function usePrefetchAsset() {
  const queryClient = useQueryClient();
  const warmed = useRef(new Set<string>());

  return useCallback(
    (kind: AssetKind, id: string, timeframe: Timeframe = "1h") => {
      const assetId = kind === "token" ? normalizeAddress(id) : id;
      const key = `${kind}:${assetId}:${timeframe}`;
      if (warmed.current.has(key)) return;
      warmed.current.add(key);

      const url = `/api/asset/${kind}/${encodeURIComponent(assetId)}/bundle?tf=${timeframe}`;

      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;

          const bundle = (await res.json()) as {
            asset: Asset;
            seeded: boolean;
            chart: {
              points: ChartPoint[];
              changePct: number;
              error?: string | null;
              resolvedTimeframe?: Timeframe;
            };
            trades: {trades: Trade[]; pollMs?: number; error?: string | null};
          };

          if (bundle.asset?.kind === "token") rememberTokens([bundle.asset]);
          queryClient.setQueryData(["asset", kind, assetId], {
            asset: bundle.asset,
            seeded: bundle.seeded,
          });
          queryClient.setQueryData(["chart", kind, assetId, timeframe], {
            points: bundle.chart.points,
            changePct: bundle.chart.changePct,
            error: bundle.chart.error ?? null,
            resolvedTimeframe: bundle.chart.resolvedTimeframe ?? timeframe,
          });
          queryClient.setQueryData(["trades", kind, assetId], {
            trades: bundle.trades.trades,
            pollMs: bundle.trades.pollMs,
            error: bundle.trades.error ?? null,
          });
        } catch {
          // Best-effort: a failed warm just means the page loads the old way.
        }
      })();
    },
    [queryClient],
  );
}
