"use client";

import {useCallback} from "react";
import {usePublicClient, useSendTransaction} from "wagmi";

import {RH_MAINNET_ID} from "@/config/chain";
import {useSession} from "@/lib/session";
import {waitForTradeReceipt} from "@/lib/revertReason";
import type {PreparedTx} from "@/lib/swapTx";
import {
  estimatePreparedGas,
  privyUnsignedTx,
  readTxFeeFields,
  rpcTxRequest,
} from "@/lib/txGas";
import {useUser} from "./useUser";
import {useWallet} from "./useWallet";

/**
 * Send one prepared transaction from whichever wallet the person is using.
 *
 * This was written twice, identically, inside `useHodlSwap` and `useSwap`.
 * Launching needed it a third time, which is where copying it again stops
 * being defensible — the details below are load-bearing and easy to get
 * subtly wrong in a fresh copy:
 *
 *  - An imported wallet may be on another chain, so it is switched first.
 *    The embedded wallet has 4663 as its default and tolerates a failed
 *    switch.
 *  - Gas is estimated with a buffer and a floor; a revert during estimation
 *    surfaces the real reason rather than falling back to a guess.
 *  - `rpcTxRequest` sends both `gas` and `gasLimit`, because Privy's
 *    confirmation sheet reads the second one.
 *  - Nonces are left to the wallet.
 *
 * Fee fields are chosen by what the chain offers: EIP-1559 when
 * `estimateFeesPerGas` answers, legacy `gasPrice` otherwise.
 */
export function useSendTx() {
  const session = useSession();
  const user = useUser();
  const wallet = useWallet();
  const publicClient = usePublicClient({chainId: RH_MAINNET_ID});
  const {sendTransactionAsync} = useSendTransaction();

  const imported = wallet.isConnected ? wallet.address : null;
  const address = (imported ?? user.embeddedWallet ?? null) as `0x${string}` | null;

  const sendTx = useCallback(
    async (tx: PreparedTx): Promise<`0x${string}`> => {
      if (!address) throw new Error("Sign in to send from your wallet.");
      const [gas, fees] = await Promise.all([
        estimatePreparedGas({
          tx,
          account: address,
          estimateGas: publicClient
            ? (args) => publicClient.estimateGas(args)
            : undefined,
        }),
        readTxFeeFields(publicClient),
      ]);

      if (imported) {
        await wallet.ensureCorrectChain();
        const base = {
          to: tx.to,
          data: tx.data,
          value: tx.value,
          gas,
          chainId: RH_MAINNET_ID,
        } as const;
        const hash = await sendTransactionAsync(
          fees.maxFeePerGas && fees.maxPriorityFeePerGas != null
            ? {
                ...base,
                maxFeePerGas: fees.maxFeePerGas,
                maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
              }
            : fees.gasPrice
              ? {...base, gasPrice: fees.gasPrice}
              : base,
        );
        return hash as `0x${string}`;
      }

      const privyTx = privyUnsignedTx({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas,
        fees,
      });
      if (session.sendEmbeddedTransaction) {
        return (await session.sendEmbeddedTransaction(privyTx)) as `0x${string}`;
      }
      const provider = await session.getEmbeddedProvider();
      if (!provider) throw new Error("Sign in to send from your wallet.");
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          rpcTxRequest({
            from: address,
            to: tx.to,
            data: tx.data,
            value: tx.value,
            gas,
            fees,
          }),
        ],
      });
      return hash as `0x${string}`;
    },
    [address, imported, publicClient, sendTransactionAsync, session, wallet],
  );

  const wait = useCallback(
    async (hash: `0x${string}`) => {
      await waitForTradeReceipt({hash, publicClient});
    },
    [publicClient],
  );

  return {address, imported, sendTx, wait, publicClient};
}
