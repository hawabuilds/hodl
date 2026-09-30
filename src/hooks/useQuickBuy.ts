"use client";

import {useCallback, useEffect, useState} from "react";
import {useQueryClient, useQuery} from "@tanstack/react-query";
import {formatUnits} from "viem";
import {usePublicClient} from "wagmi";

import {RH_MAINNET_ID} from "@/config/chain";
import {tooSmall} from "@/config/fees";
import {useHodlSwap} from "@/hooks/useHodlSwap";
import {useLocalStore} from "@/hooks/useLocalStore";
import {useSwap} from "@/hooks/useSwap";
import {useUser} from "@/hooks/useUser";
import {allowanceSufficient, approvalSpendToken, approvalSymbol} from "@/lib/approvalFlow";
import {HODL_ROUTER_ADDRESS, hodlCanExecuteQuote, isLiveTrader} from "@/lib/liveTrade";
import {
  DEFAULT_QUICK_BUY_USD,
  readQuickBuyUsd,
  readTradeSettings,
  writeQuickBuyUsd,
  writeTradeSettings,
  type TradeSettings,
} from "@/lib/localStore";
import {isUserDeclinedTrade, reportTradeNotify} from "@/lib/notifications/reportTrade";
import {isPriced} from "@/lib/priceState";
import {useSession} from "@/lib/session";
import {fetchSwapQuote} from "@/lib/swapQuote";
import {erc20Abi} from "@/lib/swapTx";
import {
  PRICE_IMPACT_TOO_HIGH,
  liveBuyOverCap,
  quoteMissReason,
  refuseUnsafeBuyQuote,
} from "@/lib/tradePolicy";
import {buyPaysNative, buyReceivePreview, quoteOutSymbol, ticketNetOut, tradeTokenAddress} from "@/lib/tradeTicket";
import type {TokenAsset} from "@/lib/types";
import {units} from "@/lib/format";

/**
 * Quick buy from the desktop Tokens table.
 *
 * The amount is saved per user — on the profile when signed in, in the
 * browser otherwise. Slippage is the buy panel's own saved setting, so the two
 * can never disagree.
 */
export function useQuickBuySettings() {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const [localAmount] = useLocalStore(readQuickBuyUsd, DEFAULT_QUICK_BUY_USD);
  const [trade] = useLocalStore<TradeSettings>(readTradeSettings, {slippagePct: 1, currency: "USD"});
  const signedIn = user.authenticated && session.mode === "privy";
  const userId = user.user?.id ?? "";

  const remote = useQuery({
    queryKey: ["quick-buy", userId],
    enabled: signedIn,
    staleTime: Infinity,
    queryFn: async () => {
      const token = await session.getAccessToken();
      if (!token) return null;
      const res = await fetch("/api/me/quick-buy", {headers: {authorization: `Bearer ${token}`}});
      if (!res.ok) return null;
      return ((await res.json()) as {amountUsd: number | null}).amountUsd;
    },
  });

  const amountUsd = (signedIn ? remote.data : null) ?? localAmount;

  const setAmount = useCallback(
    async (amount: number) => {
      if (!(amount > 0)) return;
      writeQuickBuyUsd(amount);
      if (!signedIn) return;
      queryClient.setQueryData(["quick-buy", userId], amount);
      const token = await session.getAccessToken();
      if (!token) return;
      await fetch("/api/me/quick-buy", {
        method: "PUT",
        headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
        body: JSON.stringify({amountUsd: amount}),
      }).catch(() => undefined);
    },
    [queryClient, session, signedIn, userId],
  );

  const setSlippage = useCallback(
    (slippagePct: number) => writeTradeSettings({...readTradeSettings(), slippagePct}),
    [],
  );

  return {amountUsd, slippagePct: trade.slippagePct, setAmount, setSlippage};
}

export type QuickBuyStatus =
  | {kind: "working"; text: string}
  | {kind: "done"; text: string}
  | {kind: "error"; text: string};

/**
 * One buy of `amountUsd` of a token, through the same path as the buy panel:
 * quote, the panel's safety checks, an approval first when paying with a
 * token the router cannot spend yet, then the swap — each confirmed in the
 * wallet's own screen (Privy's, for the HODL wallet).
 */
export function useQuickBuy() {
  const session = useSession();
  const user = useUser();
  const swap = useSwap();
  const hodl = useHodlSwap();
  const publicClient = usePublicClient({chainId: RH_MAINNET_ID});
  const [busy, setBusy] = useState<string | null>(null);

  // A failed approval or swap leaves the hook in "failed"; start clean next time.
  useEffect(() => {
    if (!busy && hodl.phase === "failed") hodl.reset();
  }, [busy, hodl]);

  const buy = useCallback(
    async (
      asset: TokenAsset,
      amountUsd: number,
      slippagePct: number,
      report: (status: QuickBuyStatus) => void,
    ) => {
      if (!user.authenticated) {
        user.login();
        return;
      }
      if (user.isDemo) {
        report({kind: "error", text: "Demo mode has no signing wallet. Sign in with Privy to trade."});
        return;
      }
      const token = tradeTokenAddress(asset);
      if (!token) {
        report({kind: "error", text: `${asset.symbol} can't be bought here.`});
        return;
      }
      const small = tooSmall(amountUsd);
      if (small) {
        report({kind: "error", text: small});
        return;
      }
      if (busy) return;
      setBusy(asset.address);
      let usedLive = true;
      const symbol = asset.symbol;
      try {
        report({kind: "working", text: `Getting a price for $${amountUsd} of ${symbol}…`});
        const quoted = await fetchSwapQuote({token, side: "buy", amountUsd});
        if (!quoted.ok) {
          report({kind: "error", text: quoteMissReason(quoted.error)});
          return;
        }
        let quote = quoted.quote;
        const unsafe = refuseUnsafeBuyQuote({quote, slippagePct, amountUsd});
        if (unsafe) {
          report({kind: "error", text: unsafe});
          return;
        }
        const preview = buyReceivePreview({
          amountTokens: Number(formatUnits(ticketNetOut(quote), quote.outDecimals)),
          tokenSymbol: symbol,
          markPriceUsd: isPriced(asset.priceUsd) ? asset.priceUsd : null,
          spendUsd: amountUsd,
          quotedUsdOut: quote.usdOut ?? null,
        });
        if (preview.impactLevel === "block") {
          report({kind: "error", text: `${PRICE_IMPACT_TOO_HIGH} (${preview.impactLabel}). Try a smaller amount.`});
          return;
        }
        if ((quote.hops?.length ?? 0) > 1 && liveBuyOverCap(amountUsd)) {
          report({kind: "error", text: "This size is above the current notional cap."});
          return;
        }

        const payNative = buyPaysNative(quote);
        const live = isLiveTrader(swap.address ?? hodl.address) && hodlCanExecuteQuote(quote);
        let hash: `0x${string}`;
        usedLive = live;
        if (live) {
          const spend = approvalSpendToken({side: "buy", payNative, quoteToken: quote.quoteToken, token});
          const need = BigInt(quote.amountIn);
          if (spend && hodl.address && publicClient) {
            const current = await publicClient.readContract({
              address: spend,
              abi: erc20Abi,
              functionName: "allowance",
              args: [hodl.address, HODL_ROUTER_ADDRESS as `0x${string}`],
            });
            if (!allowanceSufficient(current, need)) {
              report({
                kind: "working",
                text: `Approving ${approvalSymbol({
                  side: "buy",
                  tokenSymbol: symbol,
                  quoteToken: quote.quoteToken,
                  quoteSymbol: quote.quoteSymbol,
                })} first — confirm in your wallet, then confirm the buy.`,
              });
              await hodl.approve(spend, need);
              // The quote has aged while the approval confirmed.
              const fresh = await fetchSwapQuote({token, side: "buy", amountUsd});
              if (!fresh.ok) {
                report({kind: "error", text: quoteMissReason(fresh.error)});
                return;
              }
              quote = fresh.quote;
            }
          }
          report({kind: "working", text: `Confirm the buy of $${amountUsd} of ${symbol} in your wallet…`});
          hash = await hodl.submit({quote, side: "buy", token, slippagePct, payNative});
        } else {
          report({kind: "working", text: `Confirm the buy of $${amountUsd} of ${symbol} in your wallet…`});
          hash = await swap.submit({quote, side: "buy", token, slippagePct, payNative});
        }

        const received = Number(formatUnits(ticketNetOut(quote), quote.outDecimals));
        report({kind: "done", text: `Bought ${units(received)} ${symbol} for $${amountUsd}.`});
        void reportTradeNotify(session.getAccessToken, {
          status: "filled",
          side: "buy",
          kind: "token",
          assetId: asset.id,
          ticker: symbol,
          tokenAmount: received,
          quoteAmount: Number(formatUnits(BigInt(quote.amountIn), quote.quoteDecimals)),
          quoteSymbol: quoteOutSymbol(quote),
          txHash: hash,
        });
      } catch (cause) {
        const reason = usedLive ? hodl.explain(cause) : swap.explain(cause);
        report({
          kind: "error",
          text: isUserDeclinedTrade(reason) ? "Buy cancelled." : reason,
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, hodl, publicClient, session, swap, user],
  );

  return {buy, busy};
}
