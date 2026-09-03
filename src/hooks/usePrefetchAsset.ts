"use client";

import {useCallback, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {Asset, AssetKind, ChartPoint, Trade} from "@/lib/types";

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
    (kind: AssetKind, id: string) => {
      const key = `${kind}:${id}`;
      if (warmed.current.has(key)) return;
      warmed.current.add(key);

      const url = `/api/asset/${kind}/${encodeURIComponent(id)}/bundle?tf=1h`;

      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;

          const bundle = (await res.json()) as {
            asset: Asset;
            seeded: boolean;
            chart: {points: ChartPoint[]; changePct: number};
            trades: {trades: Trade[]; pollMs?: number};
          };

          queryClient.setQueryData(["asset", kind, id], {
            asset: bundle.asset,
            seeded: bundle.seeded,
          });
          queryClient.setQueryData(["chart", kind, id, "1h"], {
            points: bundle.chart.points,
            changePct: bundle.chart.changePct,
          });
          queryClient.setQueryData(["trades", kind, id], {
            trades: bundle.trades.trades,
            pollMs: bundle.trades.pollMs,
          });
        } catch {
          // Best-effort: a failed warm just means the page loads the old way.
        }
      })();
    },
    [queryClient],
  );
}
