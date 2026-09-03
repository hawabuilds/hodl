"use client";

import {useCallback, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {Asset, AssetKind, ChartPoint, Trade} from "@/lib/types";

/**
 * Warms an asset's page before it is opened.
 *
 * A feed row knows where it goes the moment a finger touches it, which is a
 * few hundred milliseconds before the navigation happens and a good deal
 * longer before the page mounts and starts fetching. Doing the fetch in that
 * gap is the difference between a chart page that appears and one that appears
 * and then fills in.
 *
 * Fetches exactly what the page reads on arrival — the asset, the default
 * hour chart, and the trade tape — into the same cache keys the page's own
 * hooks use, so the page finds them already there rather than refetching.
 *
 * Everything is best-effort: a failed warm just means the page loads the way
 * it did before.
 */
export function usePrefetchAsset() {
  const queryClient = useQueryClient();

  // One warm per asset per session. Pointer events fire repeatedly while a
  // finger or cursor sits on a row, and each one would otherwise queue another
  // three requests.
  const warmed = useRef(new Set<string>());

  return useCallback(
    (kind: AssetKind, id: string) => {
      const key = `${kind}:${id}`;
      if (warmed.current.has(key)) return;
      warmed.current.add(key);

      const base = `/api/asset/${kind}/${encodeURIComponent(id)}`;

      void queryClient.prefetchQuery({
        queryKey: ["asset", kind, id],
        queryFn: async () => {
          const res = await fetch(base);
          if (!res.ok) throw new Error("prefetch failed");
          return (await res.json()) as {asset: Asset; seeded: boolean};
        },
      });

      // Matches the timeframe the chart page opens on.
      void queryClient.prefetchQuery({
        queryKey: ["chart", kind, id, "1h"],
        queryFn: async () => {
          const res = await fetch(`${base}/chart?tf=1h`);
          if (!res.ok) throw new Error("prefetch failed");
          return (await res.json()) as {
            points: ChartPoint[];
            changePct: number;
          };
        },
      });

      void queryClient.prefetchQuery({
        queryKey: ["trades", kind, id],
        queryFn: async () => {
          const res = await fetch(`${base}/trades`);
          if (!res.ok) throw new Error("prefetch failed");
          return (await res.json()) as {trades: Trade[]; pollMs?: number};
        },
      });
    },
    [queryClient],
  );
}
