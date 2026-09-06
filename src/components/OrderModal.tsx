"use client";

import {useEffect, useMemo, useState} from "react";
import {formatUnits} from "viem";
import {useBalance, useReadContract} from "wagmi";
import {RH_MAINNET_ID, txUrlForChain} from "@/config/chain";
import {feeFor, FEE_BPS, tooSmall} from "@/config/fees";
import {
  allowanceSufficient,
  approvalSpendToken,
  approvalSymbol,
  idleSignHint,
  nextTicketAction,
  pendingSignatureCopy,
  ticketButtonLabel,
} from "@/lib/approvalFlow";
import {QUOTE_USDG} from "@/lib/contracts";
import {useEthPrice} from "@/hooks/useEthPrice";
import {useHodlSwap} from "@/hooks/useHodlSwap";
import {useLocalStore} from "@/hooks/useLocalStore";
import {useSwap} from "@/hooks/useSwap";
import {
  HODL_ROUTER_ADDRESS,
  hodlCanExecuteQuote,
  isHodlRouterConfigured,
  isLiveTrader,
} from "@/lib/liveTrade";
import {
  MAX_SLIPPAGE_PCT,
  SLIPPAGE_WARN_PCT,
  readTradeSettings,
  SLIPPAGE_PRESETS,
  writeTradeSettings,
  type TradeSettings,
} from "@/lib/localStore";
import {amountOutMinimum, ticketBlockReason} from "@/lib/tradePolicy";
import {
  quoteOutSymbol,
  sellAmountInRaw,
  sellMaxEntered,
  tradeTokenAddress,
} from "@/lib/tradeTicket";
import {humanToRaw} from "@/lib/quoteAmounts";
import {cn} from "@/lib/cn";
import {formatPriceUsd, isPriced} from "@/lib/priceState";
import {money, units} from "@/lib/format";
import {fetchSwapQuote, type SwapQuote} from "@/lib/swapQuote";
import {erc20Abi} from "@/lib/swapTx";
import type {Asset} from "@/lib/types";
import {Modal} from "./ui/Modal";
import {SettingsIcon} from "./ui/Icons";

const QUICK_USD = [25, 100, 500];
const QUICK_ETH = [0.01, 0.05, 0.25];
const SELL_STEPS = [25, 50, 75, 100];

const DEFAULT_SETTINGS: TradeSettings = {slippagePct: 1, currency: "USD"};

/**
 * Buy and sell.
 *
 * Confirm quotes a Uniswap venue, encodes that route, and asks the Privy or
 * imported wallet to sign. Nothing here writes the simulated book. A missing
 * pool leaves the button disabled rather than inventing a fill.
 */
export function OrderModal({
  asset,
  side,
  onClose,
}: {
  asset: Asset | null;
  side: "buy" | "sell";
  onClose: () => void;
}) {
  const {ethUsd} = useEthPrice();
  const swap = useSwap();
  const hodl = useHodlSwap();
  const [settings] = useLocalStore<TradeSettings>(
    readTradeSettings,
    DEFAULT_SETTINGS,
  );

  const [activeSide, setActiveSide] = useState(side);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quotePending, setQuotePending] = useState(false);
  const [quoteMiss, setQuoteMiss] = useState(false);
  const [quoteAt, setQuoteAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [sellAll, setSellAll] = useState(false);

  const symbol = asset?.kind === "rwa" ? asset.ticker : (asset?.symbol ?? "");
  const token = tradeTokenAddress(asset);
  const eth = settings.currency === "ETH";
  const live =
    isLiveTrader(swap.address ?? hodl.address) && hodlCanExecuteQuote(quote);
  const ticket = live ? hodl : swap;
  const wallet = ticket.address ?? undefined;

  const ethBal = useBalance({
    address: wallet,
    chainId: RH_MAINNET_ID,
    query: {enabled: Boolean(wallet)},
  });
  const usdgBal = useReadContract({
    address: QUOTE_USDG,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    chainId: RH_MAINNET_ID,
    query: {enabled: Boolean(wallet)},
  });
  const spendToken =
    quote && !quote.quoteIsNative && !quote.quoteIsWeth
      ? quote.quoteToken
      : null;
  const spendBal = useReadContract({
    address: spendToken ?? QUOTE_USDG,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    chainId: RH_MAINNET_ID,
    query: {enabled: Boolean(wallet && spendToken && spendToken !== QUOTE_USDG)},
  });
  const tokenBal = useReadContract({
    address: token ?? QUOTE_USDG,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    chainId: RH_MAINNET_ID,
    query: {enabled: Boolean(wallet && token)},
  });
  const tokenDecimalsQ = useReadContract({
    address: token ?? QUOTE_USDG,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: RH_MAINNET_ID,
    query: {enabled: Boolean(token)},
  });
  const payNativePreview = Boolean(
    activeSide === "buy" && (quote?.quoteIsNative || quote?.quoteIsWeth),
  );
  const spendForApproval =
    live && quote && token
      ? approvalSpendToken({
          side: activeSide,
          payNative: payNativePreview,
          quoteToken: quote.quoteToken,
          token,
        })
      : null;
  const routerReady = isHodlRouterConfigured();
  const allowanceQ = useReadContract({
    address: spendForApproval ?? QUOTE_USDG,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      wallet && spendForApproval && routerReady
        ? [wallet, HODL_ROUTER_ADDRESS as `0x${string}`]
        : undefined,
    chainId: RH_MAINNET_ID,
    query: {
      enabled: Boolean(live && wallet && spendForApproval && routerReady),
    },
  });

  useEffect(() => {
    setActiveSide(side);
    setAmount("");
    setError(null);
    setFilled(null);
    setTxHash(null);
    setConfigOpen(false);
    setQuote(null);
    setQuoteMiss(false);
    setQuoteAt(0);
    setSellAll(false);
    hodl.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on asset/side only
  }, [side, asset?.id]);

  useEffect(() => {
    if (!asset) hodl.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close while a signature is pending
  }, [asset]);

  useEffect(() => {
    if (eth && ethUsd === null) {
      writeTradeSettings({...settings, currency: "USD"});
    }
  }, [eth, ethUsd, settings]);

  const rate = eth ? (ethUsd ?? 0) : 1;
  const entered = Number.parseFloat(amount);
  const amountUsd = Number.isFinite(entered) ? entered * rate : Number.NaN;
  const valid = Number.isFinite(amountUsd) && amountUsd > 0;

  const buying = activeSide === "buy";
  const tokenDecimals = Number(tokenDecimalsQ.data ?? quote?.tokenDecimals ?? 18);
  const quoteDecimals = quote?.quoteDecimals ?? 18;
  const ethUnits = ethBal.data ? Number(formatUnits(ethBal.data.value, 18)) : 0;
  const usdgUsd = usdgBal.data != null ? Number(formatUnits(usdgBal.data, 6)) : 0;
  const heldUnits =
    tokenBal.data != null ? Number(formatUnits(tokenBal.data, tokenDecimals)) : 0;
  const heldUsd =
    asset && isPriced(asset.priceUsd) ? heldUnits * asset.priceUsd : 0;
  const paysNative = quote
    ? Boolean(quote.quoteIsNative || quote.quoteIsWeth)
    : eth;
  const spendUnits =
    spendBal.data != null
      ? Number(formatUnits(spendBal.data, quoteDecimals))
      : 0;
  const quotedIn =
    quote && valid ? Number(formatUnits(BigInt(quote.amountIn), quoteDecimals)) : 0;
  const spendUsd =
    quotedIn > 0 && spendToken && spendToken !== QUOTE_USDG
      ? spendUnits * (amountUsd / quotedIn)
      : usdgUsd;

  const maxEntered = buying
    ? paysNative
      ? ethUnits
      : spendUsd
    : sellMaxEntered({heldUsd, currencyEth: eth, ethUsd});

  const fee = useMemo(() => feeFor(amountUsd), [amountUsd]);
  const undersized = valid ? tooSmall(amountUsd) : null;

  const estimatedOut = useMemo(() => {
    if (quote) {
      return Number(formatUnits(BigInt(quote.netOut), quote.outDecimals));
    }
    if (buying && asset && valid && isPriced(asset.priceUsd)) {
      return (amountUsd - fee.usd) / asset.priceUsd;
    }
    return 0;
  }, [asset, amountUsd, valid, fee.usd, quote, buying]);

  const quoteAgeMs = quoteAt > 0 ? now - quoteAt : 0;
  const quoteLeftSec = quote
    ? Math.max(0, Math.ceil((5000 - quoteAgeMs) / 1000))
    : 0;
  const quoteExpired = Boolean(quote && quoteAgeMs > 8000);

  const quoteAmountIn = useMemo(() => {
    if (!valid) return undefined;
    // ETH-denomination is only raw wei when the venue actually takes ETH/WETH.
    // RWA-paired New tokens must size via amountUsd so the server can convert.
    if (buying && (quote?.quoteIsNative || quote?.quoteIsWeth) && eth) {
      return humanToRaw(entered, 18);
    }
    if (!buying) {
      if (sellAll && tokenBal.data != null && tokenBal.data > 0n) {
        return tokenBal.data;
      }
      return sellAmountInRaw({
        amountUsd,
        heldUsd,
        heldRaw: tokenBal.data ?? 0n,
        priceUsd: asset && isPriced(asset.priceUsd) ? asset.priceUsd : null,
        decimals: tokenDecimals,
      });
    }
    return undefined;
  }, [valid, buying, eth, entered, asset, amountUsd, tokenDecimals, quote, sellAll, tokenBal.data, heldUsd]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!token || !valid) {
      setQuote(null);
      setQuoteMiss(false);
      setQuotePending(false);
      setQuoteAt(0);
      return;
    }
    const sideNow = activeSide;
    const usd = amountUsd;
    const rawIn = quoteAmountIn;
    const ctrl = new AbortController();
    let first = true;

    async function pull() {
      if (first) setQuotePending(true);
      first = false;
      try {
        const result = await fetchSwapQuote({
          token: token!,
          side: sideNow,
          amountUsd: usd,
          amountIn: rawIn,
          signal: ctrl.signal,
        });
        if (result.ok) {
          setQuote(result.quote);
          setQuoteMiss(false);
          setQuoteAt(Date.now());
          if (
            isLiveTrader(ticket.address)
            && (hodl.phase === "idle" || hodl.phase === "quoting")
          ) {
            hodl.setPhase("quoting");
          }
        } else {
          setQuote(null);
          setQuoteMiss(true);
          setQuoteAt(0);
        }
      } catch (cause) {
        if ((cause as {name?: string})?.name === "AbortError") return;
        setQuote(null);
        setQuoteMiss(true);
        setQuoteAt(0);
      } finally {
        setQuotePending(false);
      }
    }

    const start = window.setTimeout(() => void pull(), 250);
    const refresh = window.setInterval(() => void pull(), 5000);
    return () => {
      ctrl.abort();
      window.clearTimeout(start);
      window.clearInterval(refresh);
    };
  }, [token, valid, activeSide, amountUsd, quoteAmountIn, ticket.address]);

  const blocked = ticketBlockReason({
    kind: asset?.kind ?? "token",
    authenticated: ticket.authenticated,
    demo: ticket.demo,
    wallet: ticket.address,
    venue: quote?.venue ?? (quoteMiss ? null : undefined),
    quotePending,
  });

  const approvalLabel = quote
    ? approvalSymbol({
        side: activeSide,
        tokenSymbol: symbol,
        quoteToken: quote.quoteToken,
        quoteSymbol: quote.quoteSymbol,
      })
    : "USDG";
  const amountInRaw = quote ? BigInt(quote.amountIn) : 0n;
  const onChainAllowance = allowanceQ.data ?? 0n;
  const granted =
    live && hodl.lastGrant && spendForApproval && hodl.lastGrant.token === spendForApproval
      ? hodl.lastGrant.amount
      : 0n;
  const seenAllowance = onChainAllowance > granted ? onChainAllowance : granted;
  const allowanceOk =
    !live || !spendForApproval || allowanceSufficient(seenAllowance, amountInRaw);
  const allowancePending = Boolean(
    live && spendForApproval && allowanceQ.isLoading && !hodl.lastGrant,
  );
  const ticketAction = nextTicketAction({
    allowanceOk,
    allowancePending,
    side: activeSide,
    symbol,
    approvalSymbol: approvalLabel,
  });
  const walletKind = live ? hodl.walletKind : swap.walletKind;

  function setEntered(value: number) {
    setAmount(eth ? value.toFixed(6) : value.toFixed(2));
    setError(null);
    setFilled(null);
    setTxHash(null);
  }

  function switchCurrency(next: "USD" | "ETH") {
    if (next === settings.currency) return;
    if (next === "ETH" && (ethUsd === null || ethUsd <= 0)) return;
    if (valid) {
      const nextRate = next === "ETH" ? (ethUsd ?? 1) : 1;
      setAmount(
        next === "ETH"
          ? (amountUsd / nextRate).toFixed(6)
          : amountUsd.toFixed(2),
      );
    }
    writeTradeSettings({...settings, currency: next});
  }

  async function pullFreshQuote() {
    const result = await fetchSwapQuote({
      token: token!,
      side: activeSide,
      amountUsd,
      amountIn: quoteAmountIn,
    });
    if (!result.ok) {
      setQuote(null);
      setQuoteMiss(true);
      setQuoteAt(0);
      throw new Error("No Uniswap pool for this token.");
    }
    setQuote(result.quote);
    setQuoteMiss(false);
    setQuoteAt(Date.now());
    return result.quote;
  }

  async function confirm() {
    if (!asset || !valid) {
      setError("Enter an amount.");
      return;
    }
    if (blocked) {
      if (!ticket.authenticated) {
        ticket.login();
        return;
      }
      setError(blocked);
      return;
    }
    if (!token || !quote) {
      setError(
        quoteMiss
          ? "No Uniswap pool for this token."
          : "Enter an amount.",
      );
      return;
    }
    if (!isPriced(asset.priceUsd)) {
      setError("No price yet for this token.");
      return;
    }
    if (undersized) {
      setError(undersized);
      return;
    }
    if (!live && quoteExpired) {
      setError("The quote expired. Wait for a refresh and try again.");
      return;
    }

    setError(null);
    setFilled(null);
    try {
      if (!live) {
        const hash = await swap.submit({
          quote,
          side: activeSide,
          token,
          slippagePct: settings.slippagePct,
          payNative: buying && (quote.quoteIsNative || quote.quoteIsWeth),
          permit2Blocked: asset.kind === "token" && asset.launchpad?.id === "long",
        });
        setTxHash(hash);
        setFilled(
          `${buying ? "Bought" : "Sold"} ${units(estimatedOut)} ${buying ? symbol : quoteOutSymbol(quote)}`,
        );
        setAmount("");
        return;
      }

      let q = quote;
      if (quoteExpired) {
        q = await pullFreshQuote();
      }
      const payNative = buying && (q.quoteIsNative || q.quoteIsWeth);
      const spend = approvalSpendToken({
        side: activeSide,
        payNative,
        quoteToken: q.quoteToken,
        token,
      });
      const need = BigInt(q.amountIn);
      const stillCovered =
        !spend ||
        allowanceSufficient(seenAllowance, need) ||
        (hodl.lastGrant?.token === spend && hodl.lastGrant.amount >= need);

      if (spend && !stillCovered) {
        await hodl.approve(spend, need);
        await allowanceQ.refetch();
        return;
      }

      const hash = await hodl.submit({
        quote: q,
        side: activeSide,
        token,
        slippagePct: settings.slippagePct,
        payNative,
      });
      setTxHash(hash);
      setFilled(
        `${buying ? "Bought" : "Sold"} ${units(estimatedOut)} ${buying ? symbol : quoteOutSymbol(q)}`,
      );
      setAmount("");
      await allowanceQ.refetch();
    } catch (cause) {
      setError(live ? hodl.explain(cause) : swap.explain(cause));
    }
  }

  const confirmDisabled =
    ticket.submitting ||
    (blocked != null && ticket.authenticated) ||
    (!valid && ticket.authenticated) ||
    undersized !== null ||
    (!live && quoteExpired) ||
    (live && allowancePending) ||
    (ticket.authenticated && !ticket.demo && valid && (quotePending || (!quote && !quoteMiss)));

  const confirmLabel = (() => {
    if (live && hodl.phase === "approving") {
      return pendingSignatureCopy(hodl.walletKind, "approve");
    }
    if (live && hodl.phase === "awaiting_signature") {
      return pendingSignatureCopy(hodl.walletKind, "swap");
    }
    if (live && hodl.phase === "pending") return "Pending…";
    if (live && hodl.phase === "confirmed") return "Confirmed";
    if (ticket.submitting) return pendingSignatureCopy(walletKind, "swap");
    if (!ticket.authenticated) return "Sign in to trade";
    if (quotePending) return "Finding route…";
    if (quoteMiss || (blocked && quote == null)) return "No pool";
    if (!live && quoteExpired) return "Quote expired";
    if (live && ticket.authenticated && quote) {
      return ticketButtonLabel(ticketAction, {
        side: activeSide,
        symbol,
        approvalSymbol: approvalLabel,
      });
    }
    return `${buying ? "Buy" : "Sell"} ${symbol}`;
  })();

  return (
    <Modal
      open={asset !== null}
      onClose={onClose}
      className="max-w-[352px] p-5 pt-5"
    >
      {asset ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-2 pr-9">
            <h2 className="truncate text-[17px] font-extrabold tracking-[-0.025em]">
              {buying ? "Buy" : "Sell"} {symbol}
            </h2>
            <button
              type="button"
              onClick={() => setConfigOpen((open) => !open)}
              aria-expanded={configOpen}
              aria-label="Order settings"
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                configOpen
                  ? "bg-[var(--overlay-wash-hover)] text-ink"
                  : "text-faint hover:bg-[var(--overlay-wash)] hover:text-ink",
              )}
            >
              <SettingsIcon className="h-[17px] w-[17px]" />
            </button>
          </div>

          {configOpen ? (
            <SlippageConfig
              settings={settings}
              onClose={() => setConfigOpen(false)}
            />
          ) : null}

          <div className="mb-3.5 flex gap-0.5 rounded-[12px] border border-hairline bg-wash p-[3px]">
            {(["buy", "sell"] as const).map((option) => {
              const active = option === activeSide;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setActiveSide(option);
                    setAmount("");
                    setSellAll(false);
                    setError(null);
                    setFilled(null);
                    setTxHash(null);
                  }}
                  className={cn(
                    "flex-1 rounded-[9px] py-2 text-[13px] font-extrabold capitalize transition-all duration-150",
                    active && option === "buy" && "bg-green text-white",
                    active && option === "sell" && "bg-red text-white",
                    !active && "text-faint",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>

          <label htmlFor="order-amount" className="sr-only">
            Amount in {eth ? "ETH" : "US dollars"}
          </label>
          <div className="rounded-panel border border-hairline bg-card px-4 py-3.5 transition-colors focus-within:border-[var(--border-hover-strong)]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
                Amount
              </span>
              <div className="flex gap-0.5 rounded-[8px] bg-wash p-[2px]">
                {(["USD", "ETH"] as const).map((option) => {
                  const active = option === settings.currency;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      disabled={option === "ETH" && ethUsd === null}
                      onClick={() => switchCurrency(option)}
                      className={cn(
                        "rounded-[6px] px-2 py-1 text-[10.5px] font-extrabold transition-colors",
                        active ? "bg-card text-ink" : "text-faint",
                        option === "ETH" && ethUsd === null && "opacity-40",
                      )}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-baseline gap-1.5">
              {eth ? null : (
                <span className="text-[24px] font-extrabold text-faint">$</span>
              )}
              <input
                id="order-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^0-9.]/g, "");
                  const parts = next.split(".");
                  const places = eth ? 6 : 2;
                  setAmount(
                    parts.length > 1
                      ? `${parts[0]}.${parts.slice(1).join("").slice(0, places)}`
                      : parts[0],
                  );
                  setSellAll(false);
                  setError(null);
                  setFilled(null);
                  setTxHash(null);
                }}
                className="tnum w-full min-w-0 border-none bg-transparent text-[30px] font-extrabold tracking-[-0.03em] text-ink outline-none placeholder:text-faint focus:outline-none focus-visible:outline-none"
              />
              {eth ? (
                <span className="text-[15px] font-extrabold text-faint">ETH</span>
              ) : null}
            </div>

            <div className="tnum mt-1 text-[12px] font-semibold text-faint">
              {valid && quote
                ? `≈ ${units(estimatedOut)} ${buying ? symbol : quoteOutSymbol(quote)}${eth ? ` · ${money(amountUsd)}` : ""}`
                : valid && buying && isPriced(asset.priceUsd)
                  ? `≈ ${units(estimatedOut)} ${symbol}${eth ? ` · ${money(amountUsd)}` : ""}`
                  : `${formatPriceUsd(asset.priceUsd)} per ${symbol}`}
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
            {buying
              ? (eth ? QUICK_ETH : QUICK_USD).map((value) => (
                  <QuickButton
                    key={value}
                    label={eth ? `${value} ETH` : `$${value}`}
                    disabled={maxEntered > 0 && value > maxEntered}
                    onClick={() => setEntered(value)}
                  />
                ))
              : SELL_STEPS.slice(0, 3).map((step) => (
                  <QuickButton
                    key={step}
                    label={`${step}%`}
                    disabled={maxEntered <= 0}
                    onClick={() => {
                      setSellAll(false);
                      setEntered((maxEntered * step) / 100);
                    }}
                  />
                ))}
            <QuickButton
              label={buying ? "Max" : "100%"}
              disabled={maxEntered <= 0}
              onClick={() => {
                if (!buying) setSellAll(true);
                setEntered(maxEntered);
              }}
            />
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-3 rounded-[13px] bg-wash px-3.5 py-2.5 text-[12.5px] font-semibold">
            <span className="text-faint">
              {buying ? "Available" : `Your ${symbol}`}
            </span>
            <span className="tnum truncate font-extrabold">
              {!wallet
                ? "—"
                : buying
                  ? paysNative
                    ? `${ethUnits.toFixed(4)} ETH`
                    : spendToken && spendToken !== QUOTE_USDG
                      ? `${units(spendUnits)} · ${money(spendUsd)}`
                      : money(usdgUsd)
                  : tokenBal.data != null
                    ? `${units(heldUnits)} · ${money(heldUsd)}`
                    : "—"}
            </span>
          </div>

          {valid && quote ? (
            <TicketBreakdown
              quote={quote}
              feeUsd={fee.usd}
              slippagePct={settings.slippagePct}
              quoteLeftSec={quoteLeftSec}
            />
          ) : valid ? (
            <div className="mt-2.5 flex items-center justify-between gap-3 px-1 text-[12px] font-semibold">
              <span className="text-faint">
                Fee
                <span className="ml-1 font-medium opacity-80">{FEE_BPS / 100}%</span>
              </span>
              <span className="tnum font-bold text-muted">{money(fee.usd)}</span>
            </div>
          ) : null}

          {quotePending && valid && !quote ? (
            <p className="mt-1.5 px-1 text-[12px] font-semibold text-faint">
              Finding route…
            </p>
          ) : null}

          {live && ticketAction === "approve" && !ticket.submitting ? (
            <p className="mt-2 px-1 text-[12px] font-semibold text-muted">
              Step 1 of 2 · Then {buying ? "Buy" : "Sell"}
            </p>
          ) : null}

          {live && (hodl.phase === "approving" || hodl.phase === "awaiting_signature") ? (
            <p className="mt-2 px-1 text-[12px] font-semibold text-muted">
              {pendingSignatureCopy(
                hodl.walletKind,
                hodl.phase === "approving" ? "approve" : "swap",
              )}
            </p>
          ) : live && hodl.phase === "pending" ? (
            <p className="mt-2 px-1 text-[12px] font-semibold text-muted">
              Waiting for the transaction to confirm…
            </p>
          ) : null}

          {error || (blocked && ticket.authenticated && !quotePending) ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-red">
              {error ?? blocked}
            </p>
          ) : null}
          {filled ? (
            <p
              role="status"
              className="mt-3 text-[12.5px] font-semibold text-green-deep"
            >
              {filled}
              {txHash ? (
                <>
                  {" · "}
                  <a
                    href={txUrlForChain(txHash, RH_MAINNET_ID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View tx
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void confirm()}
            disabled={confirmDisabled}
            className={cn(
              "mt-4 w-full rounded-[16px] py-[16px] text-[16px] font-extrabold text-white",
              "transition-[transform,opacity] duration-200 hover:-translate-y-0.5",
              "disabled:pointer-events-none disabled:bg-wash disabled:text-faint",
              buying ? "bg-green shadow-green" : "bg-red",
            )}
          >
            {confirmLabel}
          </button>

          <p className="mt-2.5 text-center text-[11px] font-medium leading-[1.5] text-faint">
            Max slippage {settings.slippagePct}% · {idleSignHint(walletKind)}
          </p>
        </>
      ) : null}
    </Modal>
  );
}

function TicketBreakdown({
  quote,
  feeUsd,
  slippagePct,
  quoteLeftSec,
}: {
  quote: SwapQuote;
  feeUsd: number;
  slippagePct: number;
  quoteLeftSec: number;
}) {
  const minOut = amountOutMinimum(BigInt(quote.netOut), slippagePct);
  const feeRaw = quote.feeAmount ? formatUnits(BigInt(quote.feeAmount), quote.quoteDecimals) : null;
  const minHuman = formatUnits(minOut, quote.outDecimals);
  return (
    <div className="mt-2.5 space-y-1 px-1 text-[12px] font-semibold">
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">HODL fee {quote.feeBps / 100}%</span>
        <span className="tnum font-bold text-muted">
          {feeRaw ? `${units(Number(feeRaw))} · ${money(feeUsd)}` : money(feeUsd)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">Creator tax</span>
        <span className="font-bold text-muted">{quote.creatorTax}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">LP fee</span>
        <span className="font-bold text-muted">{quote.lpFee || "—"}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">Price impact</span>
        <span className="font-bold text-muted">—</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">Minimum received</span>
        <span className="tnum font-bold text-muted">{units(Number(minHuman))}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">Route</span>
        <span className="font-bold text-muted">{quote.venueLabel}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-faint">Quote refresh</span>
        <span className="tnum font-bold text-muted">{quoteLeftSec}s</span>
      </div>
    </div>
  );
}

function QuickButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex-1 rounded-pill border border-hairline bg-card py-2.5 text-[12px] font-bold text-ink transition-colors hover:border-[var(--border-hover-strong)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** Slippage tolerance, kept per browser and shown on every confirm button. */
function SlippageConfig({
  settings,
  onClose,
}: {
  settings: TradeSettings;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState(
    SLIPPAGE_PRESETS.includes(
      settings.slippagePct as (typeof SLIPPAGE_PRESETS)[number],
    )
      ? ""
      : String(settings.slippagePct),
  );

  function save(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SLIPPAGE_PCT) return;
    writeTradeSettings({...settings, slippagePct: Number(value.toFixed(2))});
  }

  return (
    <div className="mb-3.5 rounded-panel border border-hairline bg-wash p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-faint">
          Max slippage
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11.5px] font-bold text-faint transition-colors hover:text-ink"
        >
          Done
        </button>
      </div>

      <div className="flex gap-2">
        {SLIPPAGE_PRESETS.map((preset) => {
          const active = settings.slippagePct === preset && custom === "";
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustom("");
                save(preset);
              }}
              className={cn(
                "flex-1 rounded-[10px] py-2 text-[12.5px] font-extrabold transition-colors",
                active ? "bg-card text-ink shadow-card" : "text-faint hover:text-muted",
              )}
            >
              {preset}%
            </button>
          );
        })}

        <label className="flex flex-1 items-center gap-0.5 rounded-[10px] bg-card px-2.5 py-2 focus-within:ring-1 focus-within:ring-[var(--border-hover-strong)]">
          <span className="sr-only">Custom slippage percentage</span>
          <input
            inputMode="decimal"
            placeholder="Custom"
            value={custom}
            onChange={(event) => {
              const next = event.target.value.replace(/[^0-9.]/g, "");
              setCustom(next);
              save(Number.parseFloat(next));
            }}
            className="tnum w-full min-w-0 border-none bg-transparent text-[12.5px] font-extrabold text-ink outline-none placeholder:font-bold placeholder:text-faint focus-visible:outline-none"
          />
          {custom ? (
            <span className="text-[12.5px] font-extrabold text-faint">%</span>
          ) : null}
        </label>
      </div>

      {settings.slippagePct > SLIPPAGE_WARN_PCT ? (
        <p role="alert" className="mt-2 text-[11px] font-bold leading-[1.45] text-red">
          Slippage above {SLIPPAGE_WARN_PCT}% can fill far from the quote.
        </p>
      ) : (
        <p className="mt-2 text-[11px] font-medium leading-[1.45] text-faint">
          An order fills only if the price stays within this much of the quote.
          Above {MAX_SLIPPAGE_PCT}% is rejected.
        </p>
      )}
    </div>
  );
}
