"use client";

import {useEffect, useMemo, useState} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";
import type {ChartPoint, Holding, PortfolioPnl, PortfolioRange} from "@/lib/types";
import {
  readKnownHoldings,
  readPortfolioCache,
  readRecentTrades,
  writeKnownHoldings,
  writePortfolioCache,
  type PortfolioCache,
} from "@/lib/localStore";
import {priceStateOf, withLastKnownPrices} from "@/lib/portfolioView";
import {useEthPrice} from "./useEthPrice";
import {useSession} from "@/lib/session";
import {useUser} from "./useUser";
import {useWallet} from "./useWallet";

interface NativeResponse {
  ethBalance: number;
}

interface PortfolioResponse {
  holdings: Holding[];
  ethBalance: number;
  degraded: boolean;
  /** Null when no fills are saved for these wallets. */
  pnl?: PortfolioPnl | null;
}

interface HistoryResponse {
  range: PortfolioRange;
  snapshots: ChartPoint[];
}

const PORTFOLIO_TTL_MS = 15_000;
/** While any price is missing or stale, ask again this often. */
const PRICE_RETRY_MS = 5_000;

export function usePortfolio(range: PortfolioRange = "1D") {
  const user = useUser();
  const session = useSession();
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

  // The last portfolio this device saw. Before sign-in has finished (the
  // wallet is not known yet) it stands in as-is; after, only if it is the
  // same wallet's.
  const [cache] = useState<PortfolioCache | null>(() => readPortfolioCache());
  const cacheFits = cache != null && (wallets.length === 0 ? !user.ready : cache.walletKey === walletKey);
  const usableCache = cacheFits ? cache : null;

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
    // Retry quickly while any price is missing or stale; otherwise a minute.
    refetchInterval: (query) =>
      (query.state.data?.holdings ?? []).some((row) => priceStateOf(row) === "pending" || priceStateOf(row) === "stale")
        ? PRICE_RETRY_MS
        : 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({wallets: walletKey});
      // Read on every fetch, so a token just traded is in the very next one.
      const known = [
        ...new Set([...wallets.flatMap((wallet) => readKnownHoldings(wallet)), ...readRecentTrades()]),
      ].slice(0, 100);
      if (known.length > 0) params.set("known", known.join(","));
      const token = await session.getAccessToken();
      const res = await fetch(`/api/portfolio?${params}`, {
        cache: "no-store",
        headers: token ? {authorization: `Bearer ${token}`} : undefined,
      });
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

  // Live when it has arrived; until then the cached copy, so the holdings are
  // on screen at once.
  const live = book.data ?? null;
  const fromCache = live == null && usableCache != null;
  const holdings = useMemo(
    () =>
      live
        ? withLastKnownPrices(live.holdings ?? [], usableCache)
        : (usableCache?.holdings ?? []),
    [live, usableCache],
  );

  const history = useQuery({
    queryKey: ["portfolio-history", walletKey, range],
    // Starts beside the holdings read rather than after it: history is stored
    // snapshots and needs nothing from the book. The live point is added below
    // only once the book is in.
    enabled: wallets.length > 0,
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

  const ethBalance = live?.ethBalance ?? native.data?.ethBalance ?? usableCache?.ethBalance ?? 0;
  // ETH is priced too: a missing ETH price is not a price of zero either.
  const ethUsd = eth.ethUsd ?? usableCache?.ethUsd ?? null;
  const ethPending = ethBalance > 0 && ethUsd == null;
  const ethValueUsd = ethUsd != null ? ethBalance * ethUsd : 0;

  const pendingCount = holdings.filter((row) => priceStateOf(row) === "pending").length;
  const staleCount = holdings.filter((row) => priceStateOf(row) === "stale").length;
  const loaded = live != null || usableCache != null;
  // Any figure built from a missing price would be wrong: the totals wait.
  const pricesPending = !loaded || pendingCount > 0 || ethPending;

  const positionsValue = holdings.reduce(
    (sum, holding) => (priceStateOf(holding) === "pending" ? sum : sum + holding.valueUsd),
    0,
  );
  const totalValue = positionsValue + ethValueUsd;

  // Save what was read, so the next visit opens on it.
  useEffect(() => {
    if (!live || wallets.length === 0) return;
    writePortfolioCache({
      walletKey,
      holdings: withLastKnownPrices(live.holdings ?? [], usableCache),
      ethBalance: live.ethBalance,
      ethUsd: eth.ethUsd ?? usableCache?.ethUsd ?? null,
      pnl: live.pnl ?? null,
      degraded: live.degraded,
      history: history.data ? {range, snapshots: history.data.snapshots} : usableCache?.history,
      savedAt: Date.now(),
    });
  }, [live, walletKey, wallets.length, eth.ethUsd, usableCache, history.data, range]);

  const points = useMemo(() => {
    const snapshots =
      history.data?.snapshots ??
      (usableCache?.history?.range === range ? usableCache.history.snapshots : []);
    // Until every price is in, the value is not known: a live point built
    // without one would draw a drop that never happened.
    if (!book.isSuccess || pricesPending) return snapshots;
    const livePoint: ChartPoint = {t: Date.now(), price: totalValue};
    const last = snapshots[snapshots.length - 1];
    if (!last) return [livePoint];
    if (livePoint.t - last.t < 1_000) {
      return [...snapshots.slice(0, -1), livePoint];
    }
    return [...snapshots, livePoint];
  }, [history.data?.snapshots, usableCache, range, totalValue, book.isSuccess, pricesPending]);

  const series = useMemo(() => points.map((point) => point.price), [points]);
  const openValue = series[0] ?? totalValue;
  const changeUsd = totalValue - openValue;

  return {
    connected: wallets.length > 0 || fromCache,
    error: book.error && !live && !usableCache ? (book.error as Error).message : null,
    holdings,
    rwaHoldings: holdings.filter((holding) => holding.kind === "rwa"),
    tokenHoldings: holdings.filter((holding) => holding.kind === "token"),
    ethBalance,
    ethValueUsd,
    ethPending,
    positionsValue,
    totalValue,
    points,
    series,
    changeUsd,
    changePct: openValue > 0 ? (changeUsd / openValue) * 100 : 0,
    isLoading: !loaded && (wallets.length > 0 || !user.ready),
    nativeReady: native.isSuccess || book.isSuccess || fromCache,
    tokensReady: book.isSuccess || fromCache,
    /** True while any figure would need a price that is not in yet. */
    pricesPending,
    /** Holdings showing their last known price because the live one failed. */
    staleCount,
    /** On screen from this device's last visit; the live read is on its way. */
    fromCache,
    degraded: live?.degraded ?? false,
    pnl: live?.pnl ?? usableCache?.pnl ?? null,
  };
}
