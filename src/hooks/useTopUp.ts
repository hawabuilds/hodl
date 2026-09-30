"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {usePublicClient} from "wagmi";

import {RH_MAINNET_ID} from "@/config/chain";
import {DUST_USD} from "@/config/fees";
import {useEthPrice} from "@/hooks/useEthPrice";
import {useHodlSwap} from "@/hooks/useHodlSwap";
import {checkBuy, useQuickBuy, type QuickBuyStatus} from "@/hooks/useQuickBuy";
import {planTopUp, spendableEthUsd, type TopUpLeg} from "@/lib/allocation";
import {SWAP_GAS_UNITS} from "@/lib/approvalFlow";
import {readTradeSettings} from "@/lib/localStore";
import type {Asset, Holding, RwaAsset, TokenAsset} from "@/lib/types";

/**
 * Top up: fresh ETH spread across the underweight holdings, nothing sold.
 *
 * Each buy goes through the buy panel's own path (`useQuickBuy`): quote, the
 * same safety checks, the price-impact block, slippage, Privy's confirm and
 * the trade notification. Before anything is signed, every leg is checked and
 * the ones that would be refused say why. While running, each buy is re-sized
 * from the ETH actually left after gas for the buys still to come, and the
 * first failure stops the run with a fresh plan to resume from.
 */

export type LegState =
  | {kind: "checking"}
  | {kind: "ready"}
  | {kind: "skip"; reason: string}
  | {kind: "running"; text: string}
  | {kind: "done"; text: string}
  | {kind: "failed"; reason: string};

export interface PlannedLeg extends TopUpLeg {
  state: LegState;
}

type Buyable = TokenAsset | RwaAsset;

async function loadAssets(keys: string[]): Promise<Map<string, Buyable>> {
  if (keys.length === 0) return new Map();
  const res = await fetch(`/api/assets?ids=${encodeURIComponent(keys.join(","))}`, {cache: "no-store"});
  if (!res.ok) throw new Error("Couldn't load prices for your holdings.");
  const {assets} = (await res.json()) as {assets: Asset[]};
  return new Map(assets.map((asset) => [`${asset.kind}:${asset.id.toLowerCase()}`, asset as Buyable]));
}

export function useTopUp(input: {open: boolean; holdings: readonly Holding[]; targets: Record<string, number>}) {
  const {open, holdings, targets} = input;
  const hodl = useHodlSwap();
  const quick = useQuickBuy();
  const eth = useEthPrice();
  const publicClient = usePublicClient({chainId: RH_MAINNET_ID});
  const queryClient = useQueryClient();

  const [amountText, setAmountText] = useState("");
  const [available, setAvailable] = useState<number | null>(null);
  const [legs, setLegs] = useState<PlannedLeg[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<QuickBuyStatus | null>(null);
  const [stopped, setStopped] = useState<{done: number; of: number; spentUsd: number; reason: string} | null>(null);
  const [finished, setFinished] = useState<{done: number; spentUsd: number} | null>(null);
  const assets = useRef(new Map<string, Buyable>());
  const checkRun = useRef(0);

  const amountUsd = Number(amountText);
  const slippagePct = readTradeSettings().slippagePct;

  /** Dollars of ETH free to spend, keeping gas back for `buys` more buys. */
  const readAvailable = useCallback(
    async (buys: number): Promise<number | null> => {
      if (!publicClient || !hodl.address || !eth.ethUsd) return null;
      const [balanceWei, gasPriceWei] = await Promise.all([
        publicClient.getBalance({address: hodl.address}),
        publicClient.getGasPrice(),
      ]);
      return spendableEthUsd({balanceWei, gasPriceWei, buys, ethUsd: eth.ethUsd, swapGasUnits: SWAP_GAS_UNITS});
    },
    [eth.ethUsd, hodl.address, publicClient],
  );

  const plan = useMemo(
    () => (Number.isFinite(amountUsd) && amountUsd > 0 ? planTopUp(holdings, targets, amountUsd) : []),
    [amountUsd, holdings, targets],
  );

  // Read what can be spent when the sheet opens; clear the last run's state.
  useEffect(() => {
    if (!open) return;
    setStopped(null);
    setFinished(null);
    setStatus(null);
    void readAvailable(Math.max(1, plan.length)).then(setAvailable).catch(() => setAvailable(null));
    // Only on open: a running top-up re-reads before every buy itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Check every leg before anything is signed, so refusals show with reasons.
  // Not while a run is going or its result is on screen: that would wipe it.
  const showingResult = stopped != null || finished != null;
  useEffect(() => {
    if (!open || running || showingResult) return;
    const run = ++checkRun.current;
    const initial = plan.map(
      (leg): PlannedLeg => ({
        ...leg,
        state: leg.belowMinimum ? {kind: "skip", reason: `Under the $${DUST_USD} minimum`} : {kind: "checking"},
      }),
    );
    setLegs(initial);
    if (initial.every((leg) => leg.state.kind !== "checking")) return;
    const timer = window.setTimeout(async () => {
      try {
        const loaded = await loadAssets(initial.map((leg) => leg.key));
        if (run !== checkRun.current) return;
        assets.current = loaded;
        const checked = await Promise.all(
          initial.map(async (leg): Promise<PlannedLeg> => {
            if (leg.state.kind !== "checking") return leg;
            const asset = loaded.get(leg.key);
            if (!asset) return {...leg, state: {kind: "skip", reason: "No live price"}};
            const result = await checkBuy(asset, leg.amountUsd, slippagePct).catch(() => ({
              ok: false as const,
              reason: "Couldn't get a price",
            }));
            return {...leg, state: result.ok ? {kind: "ready"} : {kind: "skip", reason: result.reason}};
          }),
        );
        if (run === checkRun.current) setLegs(checked);
      } catch (error) {
        if (run !== checkRun.current) return;
        const reason = error instanceof Error ? error.message : "Couldn't check these buys";
        setLegs(initial.map((leg) => (leg.state.kind === "checking" ? {...leg, state: {kind: "skip", reason}} : leg)));
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [open, plan, running, showingResult, slippagePct]);

  const readyCount = legs.filter((leg) => leg.state.kind === "ready").length;
  const overBudget = available != null && Number.isFinite(amountUsd) && amountUsd > available;

  const setLeg = (key: string, state: LegState) =>
    setLegs((current) => current.map((leg) => (leg.key === key ? {...leg, state} : leg)));

  const execute = useCallback(async () => {
    const queue = legs.filter((leg) => leg.state.kind === "ready");
    if (queue.length === 0 || running) return;
    setRunning(true);
    setStopped(null);
    setFinished(null);
    let done = 0;
    let spentUsd = 0;
    try {
      for (let index = 0; index < queue.length; index++) {
        const leg = queue[index];
        const asset = assets.current.get(leg.key);
        if (!asset) {
          setLeg(leg.key, {kind: "failed", reason: "No live price"});
          setStopped({done, of: queue.length, spentUsd, reason: `${leg.holding.symbol} has no live price.`});
          return;
        }
        // Size from the ETH actually there now, keeping gas for what is left.
        const free = await readAvailable(queue.length - index).catch(() => null);
        const size = free == null ? leg.amountUsd : Math.min(leg.amountUsd, free);
        if (size < DUST_USD) {
          setLeg(leg.key, {kind: "failed", reason: "Not enough ETH left"});
          setStopped({done, of: queue.length, spentUsd, reason: "Not enough ETH left after gas."});
          return;
        }
        const rounded = Math.floor(size * 100) / 100;
        setLeg(leg.key, {kind: "running", text: "Getting a price…"});
        const outcome = await quick.buy(asset, rounded, slippagePct, (next) => {
          setStatus(next);
          if (next.kind === "working") setLeg(leg.key, {kind: "running", text: next.text});
        });
        if (outcome.kind === "done") {
          done += 1;
          spentUsd += rounded;
          setLeg(leg.key, {kind: "done", text: outcome.text});
          continue;
        }
        if (outcome.kind === "skipped") {
          // Refused before signing (the price moved past a check): nothing
          // was spent on it, so the rest can still go.
          setLeg(leg.key, {kind: "skip", reason: outcome.reason});
          continue;
        }
        const reason = outcome.kind === "failed" ? outcome.reason : "Sign in to trade.";
        setLeg(leg.key, {kind: "failed", reason});
        setStopped({done, of: queue.length, spentUsd, reason});
        return;
      }
      setFinished({done, spentUsd});
    } finally {
      setRunning(false);
      void queryClient.invalidateQueries({queryKey: ["portfolio-tokens"]});
      void queryClient.invalidateQueries({queryKey: ["portfolio-native"]});
    }
  }, [legs, queryClient, quick, readAvailable, running, slippagePct]);

  /** After a stop: plan what was left of the amount again, from real balances. */
  const resume = useCallback(async () => {
    if (!stopped) return;
    const left = Math.max(0, Math.floor((amountUsd - stopped.spentUsd) * 100) / 100);
    await queryClient.refetchQueries({queryKey: ["portfolio-tokens"]});
    setStopped(null);
    setStatus(null);
    const free = await readAvailable(Math.max(1, plan.length)).catch(() => null);
    setAvailable(free);
    setAmountText(String(free == null ? left : Math.min(left, free)));
  }, [amountUsd, plan.length, queryClient, readAvailable, stopped]);

  return {
    /** No wallet to read or sign with (signed out, or demo mode). */
    hasWallet: Boolean(hodl.address),
    amountText,
    setAmountText,
    amountUsd,
    available,
    overBudget,
    legs,
    readyCount,
    running,
    status,
    stopped,
    finished,
    execute,
    resume,
  };
}
