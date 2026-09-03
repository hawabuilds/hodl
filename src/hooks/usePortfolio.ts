"use client";

import {useMemo} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {MARKET_REFRESH_MS} from "@/config/market";
import type {Asset, Holding, Range} from "@/lib/types";
import {useEthPrice} from "./useEthPrice";
import {useUser} from "./useUser";

/**
 * What the signed-in wallet actually holds.
 *
 * Replaces a simulated book that seeded invented positions and a starting cash
 * balance into local storage on first load, then priced them at live prices —
 * which made a fabricated portfolio look exactly like a real one, down to the
 * profit figure.
 *
 * Everything here comes from the chain: balances read from the wallet, priced
 * against the same feed the rest of the app uses. There is no cash line,
 * because a wallet does not have one, and no profit line, because a balance
 * this platform did not fill has no cost basis to measure against.
 */

interface PortfolioResponse {
  holdings: Holding[];
  ethBalance: number;
  degraded: boolean;
}

export function usePortfolio(range: Range = "1D") {
  const user = useUser();
  const wallet = user.embeddedWallet;
  const eth = useEthPrice();

  const book = useQuery({
    queryKey: ["portfolio", wallet],
    enabled: Boolean(wallet),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(
        `/api/portfolio?wallet=${encodeURIComponent(wallet!)}`,
      );
      if (!res.ok) throw new Error("Could not read your wallet.");
      return (await res.json()) as PortfolioResponse;
    },
  });

  const holdings = useMemo(
    () => book.data?.holdings ?? [],
    [book.data?.holdings],
  );

  const ids = useMemo(
    () =>
      holdings
        .map((holding) => `${holding.kind}:${holding.assetId}`)
        .sort()
        .join(","),
    [holdings],
  );

  // The value line needs each position's own history, which the feed's single
  // price does not carry.
  const priced = useQuery({
    queryKey: ["portfolio-series", ids, range],
    enabled: ids.length > 0,
    staleTime: 0,
    refetchInterval: MARKET_REFRESH_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(
        `/api/assets?range=${range}&ids=${encodeURIComponent(ids)}`,
        {cache: "no-store"},
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

  const ethBalance = book.data?.ethBalance ?? 0;
  const ethValueUsd = ethBalance * (eth.ethUsd ?? 0);
  const positionsValue = holdings.reduce(
    (sum, holding) => sum + holding.valueUsd,
    0,
  );
  const totalValue = positionsValue + ethValueUsd;

  /**
   * Portfolio value across the window.
   *
   * The ETH balance is carried flat rather than charted: its own history is a
   * separate series and the wallet's balance at each past point is not known,
   * so moving it would be a guess. A position whose series is missing holds its
   * current value instead of dropping to zero, which would draw a cliff that
   * never happened.
   */
  const series = useMemo(() => {
    if (holdings.length === 0) return [];

    const length = Math.max(
      0,
      ...holdings.map((holding) => {
        const asset = assets.get(`${holding.kind}:${holding.assetId}`);
        return asset?.series?.length ?? 0;
      }),
    );
    if (length < 2) return [];

    return Array.from({length}, (_, i) => {
      let value = ethValueUsd;
      for (const holding of holdings) {
        const asset = assets.get(`${holding.kind}:${holding.assetId}`);
        value += holding.amount * (asset?.series?.[i] ?? asset?.priceUsd ?? 0);
      }
      return value;
    });
  }, [holdings, assets, ethValueUsd]);

  const openValue = series[0] ?? totalValue;
  const changeUsd = totalValue - openValue;

  return {
    connected: Boolean(wallet),
    holdings,
    rwaHoldings: holdings.filter((holding) => holding.kind === "rwa"),
    tokenHoldings: holdings.filter((holding) => holding.kind === "token"),
    ethBalance,
    ethValueUsd,
    positionsValue,
    totalValue,
    series,
    changeUsd,
    changePct: openValue > 0 ? (changeUsd / openValue) * 100 : 0,
    /** True while the wallet has been read but nothing came back yet. */
    isLoading: Boolean(wallet) && book.isLoading,
    /** The balance read failed, so an empty list is not a claim of empty. */
    degraded: book.data?.degraded ?? false,
  };
}
