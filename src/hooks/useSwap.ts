"use client";

import {useCallback, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {usePublicClient, useSendTransaction} from "wagmi";
import {RH_MAINNET_ID} from "@/config/chain";
import {
  PERMIT2,
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
} from "@/lib/contracts";
import {useSession} from "@/lib/session";
import {
  amountOutMinimum,
  assertSaneUrBuy,
  requireBuyMinOut,
  swapDeadlineSec,
} from "@/lib/tradePolicy";
import type {SwapQuote} from "@/lib/swapQuote";
import {
  encodeApprove,
  encodePermit2Approve,
  erc20Abi,
  permit2Abi,
  prepareExactInSwap,
  type PreparedTx,
} from "@/lib/swapTx";
import {assertSpendCovered, walletKindFrom, type WalletKind} from "@/lib/approvalFlow";
import {formatRevertForUser, waitForTradeReceipt} from "@/lib/revertReason";
import {estimatePreparedGas, privyUnsignedTx, readTxFeeFields, rpcTxRequest} from "@/lib/txGas";
import {useUser} from "./useUser";
import {useWallet} from "./useWallet";

function asHash(value: unknown): `0x${string}` {
  const text = String(value ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return text as `0x${string}`;
}

export function explainSwapError(error: unknown): string {
  const formatted = formatRevertForUser(error);
  if (formatted) return formatted;
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(message)) {
    return "Wallet declined the signature.";
  }
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(message)) {
    return "Not enough ETH for gas, or not enough token to swap.";
  }
  if (/intrinsic gas too low/i.test(message)) {
    return "The wallet set a gas limit that was too low. Retry the transaction.";
  }
  if (/allowance|transfer amount exceeds|Permit2/i.test(message)) {
    return "Token approval failed. Approve the token, then confirm the swap. Tokens stay in your wallet until the swap.";
  }
  if (/TooLittleReceived|InsufficientOut|slippage/i.test(message)) {
    return "Price moved past your slippage. Try a smaller size or more slippage.";
  }
  if (/^The transaction reverted on chain\.?$/i.test(message) || /^execution reverted/i.test(message)) {
    return "The pool rejected this swap. Try a smaller size or more slippage.";
  }
  return message.slice(0, 180) || "The swap could not be sent.";
}

/**
 * Sign and broadcast the venueResolve route through Privy or an imported wallet.
 *
 * Never writes the simulated book. An empty wallet still takes this path —
 * the wallet or the node refuses the tx, the ticket does not fake a fill.
 */
export function useSwap() {
  const session = useSession();
  const user = useUser();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({chainId: RH_MAINNET_ID});
  const {sendTransactionAsync} = useSendTransaction();
  const [submitting, setSubmitting] = useState(false);

  const imported = wallet.isConnected ? wallet.address : null;
  const address = (imported ?? user.embeddedWallet ?? null) as `0x${string}` | null;
  const walletKind: WalletKind = walletKindFrom(Boolean(imported));

  const sendTx = useCallback(
    async (tx: PreparedTx): Promise<`0x${string}`> => {
      if (!address) throw new Error("Sign in to trade from your wallet.");
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
        return asHash(hash);
      }

      const privyTx = privyUnsignedTx({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas,
        fees,
      });
      if (session.sendEmbeddedTransaction) {
        return asHash(await session.sendEmbeddedTransaction(privyTx));
      }

      const provider = await session.getEmbeddedProvider();
      if (!provider) {
        throw new Error("Sign in to trade from your wallet.");
      }
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
      return asHash(hash);
    },
    [address, imported, publicClient, sendTransactionAsync, session, wallet],
  );

  const wait = useCallback(
    async (hash: `0x${string}`) => {
      await waitForTradeReceipt({hash, publicClient});
    },
    [publicClient],
  );

  const readAllowance = useCallback(
    async (token: `0x${string}`, spender: `0x${string}`): Promise<bigint> => {
      if (!publicClient || !address) return 0n;
      return publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      });
    },
    [address, publicClient],
  );

  const readBalance = useCallback(
    async (token: `0x${string}`): Promise<bigint> => {
      if (!publicClient || !address) {
        throw new Error("Wallet is not ready. Wait a moment and try again.");
      }
      return publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
    },
    [address, publicClient],
  );

  const ensureErc20Allowance = useCallback(
    async (token: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
      const current = await readAllowance(token, spender);
      if (current >= amount) return;
      const hash = await sendTx(encodeApprove(token, spender));
      await wait(hash);
    },
    [readAllowance, sendTx, wait],
  );

  const ensurePermit2 = useCallback(
    async (token: `0x${string}`, amount: bigint) => {
      if (!address) throw new Error("Sign in to trade from your wallet.");
      if (!publicClient) throw new Error("Wallet is not ready. Wait a moment and try again.");
      await ensureErc20Allowance(token, PERMIT2, amount);
      const [allowed, expiration] = await publicClient.readContract({
        address: PERMIT2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address, token, UNIVERSAL_ROUTER],
      });
      const fresh = BigInt(expiration) > BigInt(Math.floor(Date.now() / 1000) + 600);
      if (allowed >= amount && fresh) return;
      const hash = await sendTx(encodePermit2Approve(token, UNIVERSAL_ROUTER));
      await wait(hash);
      const [after, afterExp] = await publicClient.readContract({
        address: PERMIT2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address, token, UNIVERSAL_ROUTER],
      });
      const landed = BigInt(afterExp) > BigInt(Math.floor(Date.now() / 1000) + 60);
      if (after < amount || !landed) {
        throw new Error("Permit2 is not approved for this token. Approve, then sell.");
      }
    },
    [address, ensureErc20Allowance, publicClient, sendTx, wait],
  );

  const submit = useCallback(
    async (opts: {
      quote: SwapQuote;
      side: "buy" | "sell";
      token: `0x${string}`;
      slippagePct: number;
      payNative: boolean;
    }): Promise<`0x${string}`> => {
      if (!address) throw new Error("Sign in to trade from your wallet.");
      const amountIn = BigInt(opts.quote.amountIn);
      const quotedOut = BigInt(opts.quote.amountOut);
      const minOut =
        opts.side === "buy"
          ? requireBuyMinOut(amountIn, amountOutMinimum(quotedOut, opts.slippagePct))
          : amountOutMinimum(quotedOut, opts.slippagePct);
      if (opts.side === "buy" && (opts.quote.hops?.length ?? 0) > 1) {
        assertSaneUrBuy({
          amountIn,
          amountOutMinimum: minOut,
          hops: opts.quote.hops,
        });
      }
      const deadline = swapDeadlineSec();
      const tokenIn =
        opts.side === "buy" ? opts.quote.quoteToken : opts.token;
      const nativePay = opts.side === "buy" && opts.payNative;

      setSubmitting(true);
      try {
        const swapTx = prepareExactInSwap({
          venue: opts.quote.venue,
          side: opts.side,
          token: opts.token,
          quoteToken: opts.quote.quoteToken,
          quoteIsNative: opts.quote.quoteIsNative,
          quoteIsWeth: opts.quote.quoteIsWeth,
          poolKey: opts.quote.poolKey,
          v3Fee: opts.quote.v3Fee,
          zeroForOne: opts.quote.zeroForOne,
          amountIn,
          amountOutMinimum: minOut,
          deadline,
          recipient: address,
          payNative: opts.payNative,
          hops: opts.quote.hops,
        });

        if (!nativePay) {
          if (opts.side === "sell") {
            const held = await readBalance(tokenIn);
            assertSpendCovered({heldRaw: held, amount: amountIn});
          }
          if (opts.side === "sell" || opts.quote.venue === "v4") {
            await ensurePermit2(tokenIn, amountIn);
          } else {
            await ensureErc20Allowance(tokenIn, UNISWAP_SWAP_ROUTER_02, amountIn);
          }
        }

        const hash = await sendTx(swapTx);
        try {
          await wait(hash);
        } catch (error) {
          throw Object.assign(
            error instanceof Error ? error : new Error(String(error)),
            {txHash: hash},
          );
        }
        return hash;
      } finally {
        setSubmitting(false);
        void queryClient.invalidateQueries({queryKey: ["portfolio-tokens"]});
        void queryClient.invalidateQueries({queryKey: ["portfolio-native"]});
      }
    },
    [address, ensureErc20Allowance, ensurePermit2, queryClient, readBalance, sendTx, wait],
  );

  return {
    address,
    authenticated: user.authenticated,
    demo: user.isDemo,
    ready: user.ready,
    login: user.login,
    submitting,
    submit,
    walletKind,
    explain: explainSwapError,
  };
}
