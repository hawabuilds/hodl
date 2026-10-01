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
    (kind: AssetKind, id: string, timeframe?: Timeframe) => {
      const assetId = kind === "token" ? normalizeAddress(id) : id;
      const key = `${kind}:${assetId}:${timeframe ?? "default"}`;
      if (warmed.current.has(key)) return;
      warmed.current.add(key);

      // No timeframe: the server sends the page's own default (it depends on
      // the token's age), and the chart is cached under the one it sent.
      const url = `/api/asset/${kind}/${encodeURIComponent(assetId)}/bundle${timeframe ? `?tf=${timeframe}` : ""}`;

      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;

          const bundle = (await res.json()) as {
            asset: Asset;
            seeded: boolean;
            chart: {
              timeframe?: Timeframe;
              points: ChartPoint[];
              changePct: number;
              error?: string | null;
              resolvedTimeframe?: Timeframe;
            };
            trades: {
              trades: Trade[];
              pollMs?: number;
              error?: string | null;
              liveDown?: boolean;
            };
          };

          if (bundle.asset?.kind === "token") rememberTokens([bundle.asset]);
          queryClient.setQueryData(["asset", kind, assetId], {
            asset: bundle.asset,
            seeded: bundle.seeded,
          });
          const shown = bundle.chart.timeframe ?? timeframe ?? "1h";
          queryClient.setQueryData(["chart", kind, assetId, shown], {
            points: bundle.chart.points,
            changePct: bundle.chart.changePct,
            error: bundle.chart.error ?? null,
            resolvedTimeframe: bundle.chart.resolvedTimeframe ?? shown,
          });
          queryClient.setQueryData(["trades", kind, assetId], {
            trades: bundle.trades.trades,
            pollMs: bundle.trades.pollMs,
            error: bundle.trades.error ?? null,
            liveDown: bundle.trades.liveDown ?? false,
          });
        } catch {
          // Best-effort: a failed warm just means the page loads the old way.
        }
      })();
    },
    [queryClient],
  );
}
