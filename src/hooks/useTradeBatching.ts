"use client";

import {useCallback, useEffect, useState} from "react";
import {RH_MAINNET_ID} from "@/config/chain";
import {useSession} from "@/lib/session";
import type {PreparedTx} from "@/lib/swapTx";

/**
 * Two-signature detection. Robinhood Chain 4663 has no EIP-7702 and Privy
 * does not batch. Feature-detect `wallet_getCapabilities` at runtime and
 * collapse to one signature only if that wallet actually reports atomic
 * batching on 4663.
 */
export type TradePhase =
  | "idle"
  | "quoting"
  | "needs_approval"
  | "approving"
  | "awaiting_signature"
  | "pending"
  | "confirmed"
  | "failed";

const CHAIN_HEX = `0x${RH_MAINNET_ID.toString(16)}`;

export function chainSupportsAtomicBatch(capabilities: unknown, chainId = RH_MAINNET_ID): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const key = `0x${chainId.toString(16)}`;
  const row = (capabilities as Record<string, unknown>)[key]
    ?? (capabilities as Record<string, unknown>)[CHAIN_HEX];
  if (!row || typeof row !== "object") return false;
  const atomic = (row as {atomic?: {status?: string}}).atomic;
  return atomic?.status === "supported" || atomic?.status === "ready";
}

export function useTradeBatching() {
  const session = useSession();
  const [atomic, setAtomic] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const provider = await session.getEmbeddedProvider();
        if (!provider || typeof provider.request !== "function") return;
        const caps = await provider.request({
          method: "wallet_getCapabilities",
        });
        if (!cancelled) setAtomic(chainSupportsAtomicBatch(caps));
      } catch {
        if (!cancelled) setAtomic(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const sendBatch = useCallback(
    async (calls: PreparedTx[]): Promise<`0x${string}` | null> => {
      if (!atomic || calls.length < 2) return null;
      const provider = await session.getEmbeddedProvider();
      if (!provider) return null;
      try {
        const result = (await provider.request({
          method: "wallet_sendCalls",
          params: [
            {
              version: "2.0.0",
              chainId: CHAIN_HEX,
              atomicRequired: true,
              calls: calls.map((tx) => ({
                to: tx.to,
                data: tx.data,
                value: `0x${tx.value.toString(16)}`,
              })),
            },
          ],
        })) as {id?: string} | string;
        const id = typeof result === "string" ? result : result?.id;
        if (id && /^0x[0-9a-fA-F]{64}$/.test(id)) return id as `0x${string}`;
        return null;
      } catch {
        return null;
      }
    },
    [atomic, session],
  );

  return {atomic, sendBatch};
}
