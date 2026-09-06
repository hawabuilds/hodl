"use client";

import {useCallback, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {usePublicClient, useSendTransaction} from "wagmi";
import {RH_MAINNET_ID} from "@/config/chain";
import {
  coversNative,
  encodeHodlApprove,
  nativeWeiForPath,
  walletKindFrom,
  type WalletKind,
} from "@/lib/approvalFlow";
import {HODL_ROUTER_ADDRESS} from "@/lib/liveTrade";
import {useSession} from "@/lib/session";
import {amountOutMinimum, swapDeadlineSec} from "@/lib/tradePolicy";
import type {SwapQuote} from "@/lib/swapQuote";
import {
  encodeHodlBuy,
  encodeHodlBuyWithToken,
  encodeHodlSell,
  hintFromQuote,
} from "@/lib/hodlRouter";
import {erc20Abi, type PreparedTx} from "@/lib/swapTx";
import {formatRevertForUser, waitForTradeReceipt} from "@/lib/revertReason";
import {estimatePreparedGas, readTxFeeFields, rpcTxRequest} from "@/lib/txGas";
import {useTradeBatching, type TradePhase} from "./useTradeBatching";
import {useUser} from "./useUser";
import {useWallet} from "./useWallet";

function asHash(value: unknown): `0x${string}` {
  const text = String(value ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return text as `0x${string}`;
}

export function explainHodlError(error: unknown): string {
  const formatted = formatRevertForUser(error);
  if (formatted) return formatted;
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(message)) {
    return "You declined the signature.";
  }
  if (/Not enough ETH to cover approval and swap gas/i.test(message)) {
    return "Not enough ETH to cover approval and swap gas.";
  }
  if (/insufficient funds|exceeds the balance of the account/i.test(message)) {
    return "Not enough ETH for gas.";
  }
  if (/intrinsic gas too low/i.test(message)) {
    return "The wallet set a gas limit that was too low. Retry the transaction.";
  }
  if (/transfer amount exceeds|insufficient balance|ERC20InsufficientBalance/i.test(message)) {
    return "Insufficient token balance for this size.";
  }
  if (/Approve this token first/i.test(message)) {
    return "Approve this token first.";
  }
  if (/Dust|dust/i.test(message)) {
    return "Trade is below the $1 minimum.";
  }
  if (/Cap|maxNotional/i.test(message)) {
    return "This size is above the current notional cap.";
  }
  if (/DeadlineExpired|TransactionDeadlinePassed/i.test(message)) {
    return "The quote expired. Wait for a refresh and try again.";
  }
  if (/InsufficientOut|TooLittleReceived|slippage|STF/i.test(message)) {
    return "Price moved past your slippage. Try a smaller size or more slippage.";
  }
  if (/no liquidity|NoPool|BadPool|BadPair/i.test(message)) {
    return "No liquidity on this route.";
  }
  if (/Paused/i.test(message)) {
    return "Trading is paused.";
  }
  if (/non-tradeable|not tradeable|eligible/i.test(message)) {
    return "This token is not tradeable.";
  }
  if (/^The transaction reverted on chain\.?$/i.test(message) || /^execution reverted/i.test(message)) {
    return "The pool rejected this swap. Try a smaller size or more slippage.";
  }
  return message.slice(0, 180) || "The swap could not be sent.";
}

export function useHodlSwap() {
  const session = useSession();
  const user = useUser();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({chainId: RH_MAINNET_ID});
  const {sendTransactionAsync} = useSendTransaction();
  const batching = useTradeBatching();
  const [phase, setPhase] = useState<TradePhase>("idle");
  const [lastGrant, setLastGrant] = useState<{token: string; amount: bigint} | null>(null);
  const runId = useRef(0);

  const imported = wallet.isConnected ? wallet.address : null;
  const address = (imported ?? user.embeddedWallet ?? null) as `0x${string}` | null;
  const router = HODL_ROUTER_ADDRESS as `0x${string}`;
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
        const hash = await sendTransactionAsync(
          fees.maxFeePerGas && fees.maxPriorityFeePerGas != null
            ? {
                to: tx.to,
                data: tx.data,
                value: tx.value,
                gas,
                maxFeePerGas: fees.maxFeePerGas,
                maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
                chainId: RH_MAINNET_ID,
              }
            : fees.gasPrice
              ? {
                  to: tx.to,
                  data: tx.data,
                  value: tx.value,
                  gas,
                  gasPrice: fees.gasPrice,
                  chainId: RH_MAINNET_ID,
                }
              : {
                  to: tx.to,
                  data: tx.data,
                  value: tx.value,
                  gas,
                  chainId: RH_MAINNET_ID,
                },
        );
        return asHash(hash);
      }
      const provider = await session.getEmbeddedProvider();
      if (!provider) throw new Error("Sign in to trade from your wallet.");
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

  const invalidateCaches = useCallback(() => {
    void queryClient.invalidateQueries({queryKey: ["portfolio-tokens"]});
    void queryClient.invalidateQueries({queryKey: ["portfolio-native"]});
  }, [queryClient]);

  const reset = useCallback(() => {
    runId.current += 1;
    setPhase("idle");
    setLastGrant(null);
  }, []);

  const ensureNativeForPath = useCallback(
    async (txs: 1 | 2, nativeValue = 0n) => {
      if (!publicClient || !address) return;
      const [balance, gasPrice] = await Promise.all([
        publicClient.getBalance({address}),
        publicClient.getGasPrice(),
      ]);
      const needed = nativeWeiForPath({txs, gasPrice, nativeValue});
      if (!coversNative(balance, needed)) {
        throw new Error(
          txs === 2
            ? "Not enough ETH to cover approval and swap gas."
            : "Not enough ETH for gas.",
        );
      }
    },
    [address, publicClient],
  );

  const approve = useCallback(
    async (token: `0x${string}`, amount: bigint): Promise<`0x${string}` | null> => {
      if (!address) throw new Error("Sign in to trade from your wallet.");
      if (!/^0x[a-f0-9]{40}$/.test(router)) {
        throw new Error("HodlRouter is not configured.");
      }
      const gen = runId.current;
      try {
        const current = await readAllowance(token, router);
        if (current >= amount) {
          setLastGrant({token: token.toLowerCase(), amount: current});
          if (gen === runId.current) setPhase("idle");
          return null;
        }
        await ensureNativeForPath(2);
        setPhase("approving");
        const hash = await sendTx(encodeHodlApprove(token, router, amount));
        if (gen !== runId.current) return hash;
        setPhase("pending");
        await wait(hash);
        const after = await readAllowance(token, router);
        setLastGrant({
          token: token.toLowerCase(),
          amount: after >= amount ? after : amount,
        });
        if (gen === runId.current) setPhase("idle");
        return hash;
      } catch (error) {
        if (gen === runId.current) setPhase("failed");
        throw error;
      }
    },
    [address, ensureNativeForPath, readAllowance, router, sendTx, wait],
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
      if (!/^0x[a-f0-9]{40}$/.test(router)) {
        throw new Error("HodlRouter is not configured.");
      }
      const amountIn = BigInt(opts.quote.amountIn);
      // Sells skim the output after the swap, so slippage binds the gross quoter
      // amount. Buys already quoted the post-fee input, so netOut == amountOut.
      const quotedOut =
        opts.side === "sell" ? BigInt(opts.quote.amountOut) : BigInt(opts.quote.netOut);
      const minOut = amountOutMinimum(quotedOut, opts.slippagePct);
      const deadline = swapDeadlineSec();
      const hint = hintFromQuote(opts.quote, opts.token, opts.side);
      const nativePay = opts.side === "buy" && opts.payNative;
      const gen = runId.current;

      try {
        if (nativePay) {
          await ensureNativeForPath(1, amountIn);
          setPhase("awaiting_signature");
          const hash = await sendTx(
            encodeHodlBuy({
              router,
              tokenOut: opts.token,
              minAmountOut: minOut,
              hint,
              deadline,
              value: amountIn,
            }),
          );
          if (gen !== runId.current) return hash;
          setPhase("pending");
          await wait(hash);
          if (gen === runId.current) setPhase("confirmed");
          return hash;
        }

        const tokenIn = opts.side === "buy" ? opts.quote.quoteToken : opts.token;
        const tokenOut =
          opts.side === "buy"
            ? opts.token
            : opts.quote.quoteIsNative || opts.quote.quoteIsWeth
              ? "0x0000000000000000000000000000000000000000"
              : opts.quote.quoteToken;

        const allowed = await readAllowance(tokenIn, router);
        if (allowed < amountIn) {
          throw new Error("Approve this token first.");
        }

        await ensureNativeForPath(1);
        setPhase("awaiting_signature");
        const hash = await sendTx(
          opts.side === "buy"
            ? encodeHodlBuyWithToken({
                router,
                tokenIn,
                amountIn,
                tokenOut,
                minAmountOut: minOut,
                hint,
                deadline,
              })
            : encodeHodlSell({
                router,
                tokenIn,
                amountIn,
                tokenOut,
                minAmountOut: minOut,
                hint,
                deadline,
              }),
        );
        if (gen !== runId.current) return hash;
        setPhase("pending");
        await wait(hash);
        setLastGrant(null);
        if (gen === runId.current) setPhase("confirmed");
        return hash;
      } catch (error) {
        if (gen === runId.current) setPhase("failed");
        throw error;
      } finally {
        invalidateCaches();
      }
    },
    [address, ensureNativeForPath, invalidateCaches, readAllowance, router, sendTx, wait],
  );

  return {
    address,
    authenticated: user.authenticated,
    demo: user.isDemo,
    ready: user.ready,
    login: user.login,
    submitting: phase === "approving" || phase === "awaiting_signature" || phase === "pending",
    phase,
    setPhase,
    reset,
    approve,
    lastGrant,
    walletKind,
    submit,
    explain: explainHodlError,
    atomic: batching.atomic,
  };
}
