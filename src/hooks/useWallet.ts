"use client";

import {useCallback} from "react";
import {useAccount, useConnect, useDisconnect, useSwitchChain} from "wagmi";
import {RH_MAINNET_ID} from "@/config/chain";

/**
 * The external wallet someone imports alongside the Privy embedded one, and the
 * plumbing to get it connected and onto Robinhood Chain.
 */
export function useWallet() {
  const {address, connector, isConnected, chainId} = useAccount();
  const {connectors, connectAsync, isPending, error} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChainAsync} = useSwitchChain();

  const onWrongChain = isConnected && chainId !== RH_MAINNET_ID;

  const connectWith = useCallback(
    async (connectorId: string) => {
      const target = connectors.find((c) => c.uid === connectorId);
      if (!target) throw new Error("That wallet is no longer available.");
      await connectAsync({connector: target, chainId: RH_MAINNET_ID});
    },
    [connectAsync, connectors],
  );

  const ensureCorrectChain = useCallback(async () => {
    if (!onWrongChain) return;
    await switchChainAsync({chainId: RH_MAINNET_ID});
  }, [onWrongChain, switchChainAsync]);

  return {
    address: address ?? null,
    walletName: connector?.name ?? null,
    isConnected,
    onWrongChain,
    connectors,
    connectWith,
    ensureCorrectChain,
    disconnect,
    isConnecting: isPending,
    error: error?.message ?? null,
  };
}
