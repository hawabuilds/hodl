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
import {fetchSwapQuote, tradeCurrency, type SwapQuote, type TradeCurrency} from "@/lib/swapQuote";
import {QUOTE_USDG} from "@/lib/contracts";
import {erc20Abi} from "@/lib/swapTx";
import {
  LIVE_BUY_OVER_CAP,
  PRICE_IMPACT_TOO_HIGH,
  liveBuyOverCap,
  quoteMissReason,
  refuseUnsafeBuyQuote,
} from "@/lib/tradePolicy";
import {buyPaysNative, buyReceivePreview, quoteOutSymbol, ticketNetOut, tradeTokenAddress} from "@/lib/tradeTicket";
import type {RwaAsset, TokenAsset} from "@/lib/types";
import {units} from "@/lib/format";
import {refreshPortfolioAfterTrade} from "@/lib/portfolioRefresh";

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
  const [trade] = useLocalStore<TradeSettings>(readTradeSettings, {slippagePct: 1, currency: "USD", receive: "USD"});
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

/** What one buy came to. `skipped` never reached the wallet; `failed` did, or was declined there. */
export type BuyOutcome =
  | {kind: "done"; hash: `0x${string}`; text: string}
  | {kind: "skipped"; reason: string}
  | {kind: "failed"; reason: string; declined: boolean}
  | {kind: "sign-in"};

/** A buy that passed every check, ready to sign. */
interface CheckedBuy {
  ok: true;
  quote: SwapQuote;
  token: `0x${string}`;
}

/** Why a buy would not be sent, before anything is signed. */
export type BuyCheck = CheckedBuy | {ok: false; reason: string; impact?: boolean};

type BuyableAsset = TokenAsset | RwaAsset;

const symbolOf = (asset: BuyableAsset) => (asset.kind === "rwa" ? asset.ticker : asset.symbol);

/** Quick buy's copy when paying USD and the wallet's USDG is short. */
export const QUICK_BUY_USDG_SHORT = "Not enough USDG. Switch to ETH in the buy panel to pay with ETH.";

/** What quick buy pays with: the buy panel's saved USD/ETH choice. */
export function quickBuyCurrency(): TradeCurrency {
  return tradeCurrency(readTradeSettings().currency);
}

/**
 * The buy panel's checks for `amountUsd` of an asset, without signing: a
 * quote, the size minimum, the unsafe-quote guard, the price-impact block and
 * the $100 trade cap. Top up runs this first so every refusal is shown with its
 * reason before anything is sent.
 */
export async function checkBuy(
  asset: BuyableAsset,
  amountUsd: number,
  slippagePct: number,
  currency: TradeCurrency = quickBuyCurrency(),
): Promise<BuyCheck> {
  const token = tradeTokenAddress(asset);
  if (!token) return {ok: false, reason: `${symbolOf(asset)} can't be bought here.`};
  const small = tooSmall(amountUsd);
  if (small) return {ok: false, reason: small};
  if (liveBuyOverCap(amountUsd)) return {ok: false, reason: LIVE_BUY_OVER_CAP};
  const quoted = await fetchSwapQuote({token, side: "buy", amountUsd, currency});
  if (!quoted.ok) return {ok: false, reason: quoteMissReason(quoted.error)};
  const quote = quoted.quote;
  const unsafe = refuseUnsafeBuyQuote({quote, slippagePct, amountUsd});
  if (unsafe) return {ok: false, reason: unsafe};
  const preview = buyReceivePreview({
    amountTokens: Number(formatUnits(ticketNetOut(quote), quote.outDecimals)),
    tokenSymbol: symbolOf(asset),
    markPriceUsd: isPriced(asset.priceUsd) ? asset.priceUsd : null,
    spendUsd: amountUsd,
    quotedUsdOut: quote.usdOut ?? null,
  });
  if (preview.impactLevel === "block") {
    return {ok: false, reason: `${PRICE_IMPACT_TOO_HIGH} (${preview.impactLabel})`, impact: true};
  }
  return {ok: true, quote, token};
}

/**
 * One buy of `amountUsd` of a token or a stock, through the same path as the
 * buy panel: quote, the panel's safety checks, an exact-amount approval first
 * when paying with a token the router cannot spend yet, then the swap — each
 * confirmed in the wallet's own screen (Privy's, for the HODL wallet).
 */
export function useQuickBuy() {
  const session = useSession();
  const queryClient = useQueryClient();
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
      asset: BuyableAsset,
      amountUsd: number,
      slippagePct: number,
      report: (status: QuickBuyStatus) => void,
    ): Promise<BuyOutcome> => {
      if (!user.authenticated) {
        user.login();
        return {kind: "sign-in"};
      }
      const symbol = symbolOf(asset);
      const refuse = (reason: string): BuyOutcome => {
        report({kind: "error", text: reason});
        return {kind: "skipped", reason};
      };
      if (user.isDemo) return refuse("Demo mode has no signing wallet. Sign in with Privy to trade.");
      if (busy) return refuse("Another buy is still running.");
      setBusy(asset.id);
      let usedLive = true;
      try {
        report({kind: "working", text: `Getting a price for $${amountUsd} of ${symbol}…`});
        const currency = quickBuyCurrency();
        const checked = await checkBuy(asset, amountUsd, slippagePct, currency);
        if (!checked.ok) return refuse(checked.reason);
        let {quote} = checked;
        const {token} = checked;

        const payer = swap.address ?? hodl.address;
        if (currency === "usdg" && payer && publicClient) {
          const usdg = await publicClient.readContract({
            address: QUOTE_USDG,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [payer],
          });
          if (usdg < BigInt(quote.amountIn)) return refuse(QUICK_BUY_USDG_SHORT);
        }

        const payNative = buyPaysNative(quote);
        const live = isLiveTrader(swap.address ?? hodl.address) && hodlCanExecuteQuote(quote, "buy");
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
              args: [hodl.address, HODL_ROUTER_ADDRESS],
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
              // One-time max approval; later buys skip this step.
              await hodl.approve(spend, need);
              // The quote has aged while the approval confirmed.
              const fresh = await fetchSwapQuote({token, side: "buy", amountUsd, currency});
              if (!fresh.ok) return refuse(quoteMissReason(fresh.error));
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
        const text = `Bought ${units(received)} ${symbol} for $${amountUsd}.`;
        report({kind: "done", text});
        refreshPortfolioAfterTrade(queryClient, asset.kind, asset.id);
        void reportTradeNotify(session.getAccessToken, {
          status: "filled",
          side: "buy",
          kind: asset.kind,
          assetId: asset.id,
          ticker: symbol,
          tokenAmount: received,
          quoteAmount: Number(formatUnits(BigInt(quote.amountIn), quote.quoteDecimals)),
          quoteSymbol: quoteOutSymbol(quote),
          txHash: hash,
        });
        return {kind: "done", hash, text};
      } catch (cause) {
        const reason = usedLive ? hodl.explain(cause) : swap.explain(cause);
        const declined = isUserDeclinedTrade(reason);
        report({kind: "error", text: declined ? "Buy cancelled." : reason});
        return {kind: "failed", reason: declined ? "Cancelled in your wallet." : reason, declined};
      } finally {
        setBusy(null);
      }
    },
    [busy, hodl, publicClient, queryClient, session, swap, user],
  );

  return {buy, busy};
}
