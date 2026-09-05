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
  swapDeadlineSec,
} from "@/lib/tradePolicy";
import type {SwapQuote} from "@/lib/swapQuote";
import {
  buildV3Swap,
  buildV4Swap,
  encodeApprove,
  encodePermit2Approve,
  encodeTransfer,
  erc20Abi,
  permit2Abi,
  type PreparedTx,
} from "@/lib/swapTx";
import {useUser} from "./useUser";
import {useWallet} from "./useWallet";

function asHash(value: unknown): `0x${string}` {
  const text = String(value ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return text as `0x${string}`;
}

function explainSwapError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(message)) {
    return "Wallet declined the signature.";
  }
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(message)) {
    return "Not enough ETH for gas, or not enough token to swap.";
  }
  if (/allowance|transfer amount exceeds|Permit2/i.test(message)) {
    return "Token approval failed. Long tokens block Permit2 — try again and the ticket will transfer first.";
  }
  if (/reverted|execution reverted|slippage/i.test(message)) {
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

  const sendTx = useCallback(
    async (tx: PreparedTx): Promise<`0x${string}`> => {
      if (imported) {
        await wallet.ensureCorrectChain();
        const hash = await sendTransactionAsync({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          chainId: RH_MAINNET_ID,
        });
        return asHash(hash);
      }

      const provider = await session.getEmbeddedProvider();
      if (!provider) {
        throw new Error("Sign in to trade from your wallet.");
      }
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: tx.to,
            data: tx.data,
            value: `0x${tx.value.toString(16)}`,
          },
        ],
      });
      return asHash(hash);
    },
    [address, imported, sendTransactionAsync, session, wallet],
  );

  const wait = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) return;
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status === "reverted") {
        throw new Error("The transaction reverted on chain.");
      }
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
      await ensureErc20Allowance(token, PERMIT2, amount);
      if (!publicClient || !address) return;
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
      permit2Blocked: boolean;
    }): Promise<`0x${string}`> => {
      if (!address) throw new Error("Sign in to trade from your wallet.");
      const amountIn = BigInt(opts.quote.amountIn);
      const minOut = amountOutMinimum(BigInt(opts.quote.amountOut), opts.slippagePct);
      const deadline = swapDeadlineSec();
      const tokenIn =
        opts.side === "buy" ? opts.quote.quoteToken : opts.token;
      const tokenOut =
        opts.side === "buy" ? opts.token : opts.quote.quoteToken;
      const nativePay = opts.side === "buy" && opts.payNative;

      setSubmitting(true);
      try {
        if (opts.quote.venue === "v4") {
          if (!opts.quote.poolKey) {
            throw new Error("No Uniswap pool for this token.");
          }
          if (nativePay && (opts.quote.quoteIsNative || opts.quote.quoteIsWeth)) {
            const hash = await sendTx(
              buildV4Swap({
                poolKey: opts.quote.poolKey,
                zeroForOne: opts.quote.zeroForOne,
                amountIn,
                amountOutMinimum: minOut,
                deadline,
                nativeIn: opts.quote.quoteIsNative,
                wrapEth: opts.quote.quoteIsWeth,
              }),
            );
            await wait(hash);
            return hash;
          }

          let alreadyOnRouter = opts.permit2Blocked;
          if (!alreadyOnRouter) {
            try {
              await ensurePermit2(tokenIn, amountIn);
            } catch {
              alreadyOnRouter = true;
            }
          }
          if (alreadyOnRouter) {
            const move = await sendTx({
              to: tokenIn,
              data: encodeTransfer(UNIVERSAL_ROUTER, amountIn),
              value: 0n,
            });
            await wait(move);
          }
          const hash = await sendTx(
            buildV4Swap({
              poolKey: opts.quote.poolKey,
              zeroForOne: opts.quote.zeroForOne,
              amountIn,
              amountOutMinimum: minOut,
              deadline,
              alreadyOnRouter,
            }),
          );
          await wait(hash);
          return hash;
        }

        if (opts.quote.v3Fee == null) {
          throw new Error("No Uniswap pool for this token.");
        }
        if (!nativePay) {
          await ensureErc20Allowance(tokenIn, UNISWAP_SWAP_ROUTER_02, amountIn);
        }
        const hash = await sendTx(
          buildV3Swap({
            tokenIn,
            tokenOut,
            fee: opts.quote.v3Fee,
            recipient: address,
            amountIn,
            amountOutMinimum: minOut,
            nativeIn: nativePay && (opts.quote.quoteIsWeth || opts.quote.quoteIsNative),
          }),
        );
        await wait(hash);
        return hash;
      } finally {
        setSubmitting(false);
        void queryClient.invalidateQueries({queryKey: ["portfolio-tokens"]});
        void queryClient.invalidateQueries({queryKey: ["portfolio-native"]});
      }
    },
    [address, ensureErc20Allowance, ensurePermit2, queryClient, sendTx, wait],
  );

  return {
    address,
    authenticated: user.authenticated,
    demo: user.isDemo,
    ready: user.ready,
    login: user.login,
    submitting,
    submit,
    explain: explainSwapError,
  };
}
