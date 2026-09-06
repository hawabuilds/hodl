"use client";

import {useEffect, useMemo} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import type {ChartPoint, Holding, PortfolioRange} from "@/lib/types";
import {readKnownHoldings, writeKnownHoldings} from "@/lib/localStore";
import {useEthPrice} from "./useEthPrice";
import {useUser} from "./useUser";
import {useWallet} from "./useWallet";

interface NativeResponse {
  ethBalance: number;
}

interface PortfolioResponse {
  holdings: Holding[];
  ethBalance: number;
  degraded: boolean;
}

interface HistoryResponse {
  range: PortfolioRange;
  snapshots: ChartPoint[];
}

const PORTFOLIO_TTL_MS = 15_000;

export function usePortfolio(range: PortfolioRange = "1D") {
  const user = useUser();
  const imported = useWallet();
  const wallets = useMemo(() => {
    const out: string[] = [];
    for (const value of [user.embeddedWallet, imported.address]) {
      const address = value?.toLowerCase();
      if (address && /^0x[a-f0-9]{40}$/.test(address) && !out.includes(address)) {
        out.push(address);
      }
    }
    return out;
  }, [user.embeddedWallet, imported.address]);
  const walletKey = wallets.join(",");
  const eth = useEthPrice();

  const known = useMemo(
    () => wallets.flatMap((wallet) => readKnownHoldings(wallet)),
    [wallets],
  );

  const native = useQuery({
    queryKey: ["portfolio-native", walletKey],
    enabled: wallets.length > 0,
    staleTime: PORTFOLIO_TTL_MS,
    gcTime: 30 * 60_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(
        `/api/portfolio?phase=native&wallets=${encodeURIComponent(walletKey)}`,
        {cache: "no-store"},
      );
      if (!res.ok) throw new Error("Could not read your wallet.");
      return (await res.json()) as NativeResponse;
    },
  });

  const book = useQuery({
    queryKey: ["portfolio-tokens", walletKey],
    enabled: wallets.length > 0,
    staleTime: PORTFOLIO_TTL_MS,
    gcTime: 30 * 60_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({wallets: walletKey});
      if (known.length > 0) params.set("known", known.join(","));
      const res = await fetch(`/api/portfolio?${params}`, {cache: "no-store"});
      if (!res.ok) throw new Error("Could not read your wallet.");
      return (await res.json()) as PortfolioResponse;
    },
  });

  useEffect(() => {
    const held = book.data?.holdings ?? [];
    if (held.length === 0 || wallets.length === 0) return;
    const addresses = held
      .filter((row) => row.kind === "token")
      .map((row) => row.assetId);
    for (const wallet of wallets) writeKnownHoldings(wallet, addresses);
  }, [book.data?.holdings, wallets]);

  const holdings = useMemo(
    () => book.data?.holdings ?? [],
    [book.data?.holdings],
  );

  const history = useQuery({
    queryKey: ["portfolio-history", walletKey, range],
    enabled: wallets.length > 0 && book.isSuccess,
    staleTime: PORTFOLIO_TTL_MS,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({
        wallets: walletKey,
        range,
      });
      const res = await fetch(`/api/portfolio/history?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not read portfolio history.");
      return (await res.json()) as HistoryResponse;
    },
  });

  const ethBalance = book.data?.ethBalance ?? native.data?.ethBalance ?? 0;
  const ethValueUsd = ethBalance * (eth.ethUsd ?? 0);
  const positionsValue = holdings.reduce(
    (sum, holding) => sum + holding.valueUsd,
    0,
  );
  const totalValue = positionsValue + ethValueUsd;

  const points = useMemo(() => {
    const snapshots = history.data?.snapshots ?? [];
    const live: ChartPoint = {t: Date.now(), price: totalValue};
    const last = snapshots[snapshots.length - 1];
    if (!last) return book.isSuccess ? [live] : [];
    if (live.t - last.t < 1_000) {
      return [...snapshots.slice(0, -1), live];
    }
    return [...snapshots, live];
  }, [history.data?.snapshots, totalValue, book.isSuccess]);

  const series = useMemo(() => points.map((point) => point.price), [points]);
  const openValue = series[0] ?? totalValue;
  const changeUsd = totalValue - openValue;

  return {
    connected: wallets.length > 0,
    error: book.error ? (book.error as Error).message : null,
    holdings,
    rwaHoldings: holdings.filter((holding) => holding.kind === "rwa"),
    tokenHoldings: holdings.filter((holding) => holding.kind === "token"),
    ethBalance,
    ethValueUsd,
    positionsValue,
    totalValue,
    points,
    series,
    changeUsd,
    changePct: openValue > 0 ? (changeUsd / openValue) * 100 : 0,
    isLoading: wallets.length > 0 && book.isLoading && holdings.length === 0,
    nativeReady: native.isSuccess || book.isSuccess,
    tokensReady: book.isSuccess,
    degraded: book.data?.degraded ?? false,
  };
}
