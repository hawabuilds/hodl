"use client";

import {useCallback, useMemo} from "react";
import {keepPreviousData, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  applyFill,
  readBook,
  STARTING_CASH_USD,
  type Book,
  type FillInput,
} from "@/lib/localStore";
import type {Asset, Holding, Range} from "@/lib/types";
import {useLocalStore} from "./useLocalStore";

const EMPTY: Book = {cashUsd: STARTING_CASH_USD, positions: [], orders: []};

export interface ValuedHolding extends Holding {
  /** Unrealised profit and loss in dollars, against the average entry. */
  pnlUsd: number;
  pnlPct: number;
}

/**
 * The trade simulator's book.
 *
 * Only the order ticket reads this now. It used to seed invented positions and
 * a starting balance on first load, and the profile priced them at live prices
 * — which made a fabricated portfolio indistinguishable from a real one. The
 * profile reads the wallet instead, through `usePortfolio`, and this opens
 * empty.
 *
 * Positions live in the browser; prices come from one batched lookup so a book
 * with a dozen names does not fire a dozen requests.
 */
export function useBook(range: Range = "1D") {
  const queryClient = useQueryClient();
  const [book] = useLocalStore<Book>(readBook, EMPTY);

  const ids = useMemo(
    () => book.positions.map((p) => `${p.kind}:${p.assetId}`).sort(),
    [book.positions],
  );

  const priced = useQuery({
    queryKey: ["book-prices", ids, range],
    enabled: ids.length > 0,
    refetchInterval: 60_000,
    // Switching range refetches every position. Without this the holdings all
    // price at zero for a frame and the rows flash a full loss.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(
        `/api/assets?range=${range}&ids=${encodeURIComponent(ids.join(","))}`,
      );
      if (!res.ok) throw new Error("Could not price your holdings.");
      return (await res.json()) as {assets: Asset[]};
    },
  });

  const assets = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const asset of priced.data?.assets ?? []) {
      map.set(`${asset.kind}:${asset.id}`, asset);
    }
    return map;
  }, [priced.data]);

  const holdings: ValuedHolding[] = useMemo(() => {
    return book.positions
      .map((position) => {
        const asset = assets.get(`${position.kind}:${position.assetId}`);
        const priceUsd = asset?.priceUsd ?? 0;
        const valueUsd = position.amount * priceUsd;
        const pnlUsd = valueUsd - position.costUsd;
        return {
          kind: position.kind,
          assetId: position.assetId,
          symbol: position.symbol,
          name: position.name,
          logoUrl: null,
          amount: position.amount,
          valueUsd,
          changePct: asset?.changePct ?? 0,
          costUsd: position.costUsd,
          pnlUsd,
          pnlPct: position.costUsd > 0 ? (pnlUsd / position.costUsd) * 100 : 0,
        };
      })
      .sort((a, b) => b.valueUsd - a.valueUsd);
  }, [book.positions, assets]);

  const positionsValue = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
  const totalValue = positionsValue + book.cashUsd;

  /**
   * Portfolio value across the window.
   *
   * Cash is flat, so only the positions move the line. A position whose series
   * is missing contributes its current value at every point rather than zero,
   * which would draw a cliff that never happened.
   */
  const series = useMemo(() => {
    if (holdings.length === 0) return [];
    const length = Math.max(
      ...holdings.map((holding) => {
        const asset = assets.get(`${holding.kind}:${holding.assetId}`);
        return asset?.series?.length ?? 0;
      }),
      0,
    );
    if (length < 2) return [];

    return Array.from({length}, (_, i) => {
      let value = book.cashUsd;
      for (const holding of holdings) {
        const asset = assets.get(`${holding.kind}:${holding.assetId}`);
        value += holding.amount * (asset?.series?.[i] ?? asset?.priceUsd ?? 0);
      }
      return value;
    });
  }, [holdings, assets, book.cashUsd]);

  const openValue = series[0] ?? totalValue;
  const changeUsd = totalValue - openValue;
  const changePct = openValue > 0 ? (changeUsd / openValue) * 100 : 0;

  const trade = useCallback(
    (input: FillInput) => {
      const result = applyFill(input);
      // A fill changes what needs pricing, so drop the batch result rather than
      // waiting for the next interval to notice the new position.
      if (result.ok) void queryClient.invalidateQueries({queryKey: ["book-prices"]});
      return result;
    },
    [queryClient],
  );

  return {
    cashUsd: book.cashUsd,
    orders: book.orders,
    holdings,
    rwaHoldings: holdings.filter((h) => h.kind === "rwa"),
    tokenHoldings: holdings.filter((h) => h.kind === "token"),
    positionsValue,
    totalValue,
    series,
    changeUsd,
    changePct,
    isLoading: ids.length > 0 && priced.isLoading,
    trade,
  };
}
