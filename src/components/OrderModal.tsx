"use client";

import {useEffect, useMemo, useState} from "react";
import {useBook} from "@/hooks/useBook";
import {useEthPrice} from "@/hooks/useEthPrice";
import {useLocalStore} from "@/hooks/useLocalStore";
import {
  MAX_SLIPPAGE_PCT,
  readTradeSettings,
  SLIPPAGE_PRESETS,
  writeTradeSettings,
  type TradeSettings,
} from "@/lib/localStore";
import {cn} from "@/lib/cn";
import {money, price as fmtPrice, units} from "@/lib/format";
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
 * Centred rather than sheeted from the bottom: an order is a decision, not a
 * drawer of options, and the middle of the screen is where a confirmation
 * belongs.
 *
 * The fill is simulated and recorded against the local book — nothing here
 * signs a transaction or moves funds, and the dialog says so above the confirm
 * button rather than in fine print somewhere else. The validation is real,
 * though: insufficient balance and oversized sells fail here exactly as they
 * would against a router, so wiring one in later does not change this file.
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
  const book = useBook();
  const {ethUsd} = useEthPrice();
  const [settings] = useLocalStore<TradeSettings>(
    readTradeSettings,
    DEFAULT_SETTINGS,
  );

  const [activeSide, setActiveSide] = useState(side);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const symbol = asset?.kind === "rwa" ? asset.ticker : (asset?.symbol ?? "");
  const position = book.holdings.find((h) => h.assetId === asset?.id);
  const eth = settings.currency === "ETH";

  useEffect(() => {
    setActiveSide(side);
    setAmount("");
    setError(null);
    setFilled(null);
    setConfigOpen(false);
  }, [side, asset?.id]);

  // ETH is only offered once a rate exists; sizing a trade against an unknown
  // one would be guessing.
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
  const maxUsd = buying ? book.cashUsd : (position?.valueUsd ?? 0);
  const maxEntered = rate > 0 ? maxUsd / rate : 0;

  const estimatedUnits = useMemo(() => {
    if (!asset || !valid || asset.priceUsd <= 0) return 0;
    return amountUsd / asset.priceUsd;
  }, [asset, amountUsd, valid]);

  /** Rounded to the precision the field itself accepts, so Max is spendable. */
  function setEntered(value: number) {
    setAmount(eth ? value.toFixed(6) : value.toFixed(2));
    setError(null);
    setFilled(null);
  }

  function switchCurrency(next: "USD" | "ETH") {
    if (next === settings.currency) return;
    if (next === "ETH" && (ethUsd === null || ethUsd <= 0)) return;
    // Carry the value across rather than clearing it: the amount someone meant
    // does not change because they changed how it is written.
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

  function confirm() {
    if (!asset || !valid) {
      setError("Enter an amount.");
      return;
    }

    const result = book.trade({
      kind: asset.kind,
      assetId: asset.id,
      symbol,
      name: asset.name,
      side: activeSide,
      amountUsd,
      priceUsd: asset.priceUsd,
    });

    if (!result.ok) {
      setError(result.error ?? "That order could not be filled.");
      return;
    }
    setError(null);
    setFilled(
      `${buying ? "Bought" : "Sold"} ${units(result.order?.amount ?? 0)} ${symbol}`,
    );
    setAmount("");
  }

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
                    setError(null);
                    setFilled(null);
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
                // `decimal` rather than `numeric`: an amount needs the point,
                // and `numeric` hides it on iOS.
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
                  setError(null);
                  setFilled(null);
                }}
                // The global focus ring is a green rectangle, which reads as a
                // validation state on a money field. The container takes the
                // focus treatment instead.
                className="tnum w-full min-w-0 border-none bg-transparent text-[30px] font-extrabold tracking-[-0.03em] text-ink outline-none placeholder:text-faint focus:outline-none focus-visible:outline-none"
              />
              {eth ? (
                <span className="text-[15px] font-extrabold text-faint">ETH</span>
              ) : null}
            </div>

            <div className="tnum mt-1 text-[12px] font-semibold text-faint">
              {valid && asset.priceUsd > 0
                ? `≈ ${units(estimatedUnits)} ${symbol}${eth ? ` · ${money(amountUsd)}` : ""}`
                : `${fmtPrice(asset.priceUsd)} per ${symbol}`}
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
            {buying
              ? (eth ? QUICK_ETH : QUICK_USD).map((value) => (
                  <QuickButton
                    key={value}
                    label={eth ? `${value} ETH` : `$${value}`}
                    disabled={value > maxEntered}
                    onClick={() => setEntered(value)}
                  />
                ))
              : SELL_STEPS.slice(0, 3).map((step) => (
                  <QuickButton
                    key={step}
                    label={`${step}%`}
                    disabled={maxEntered <= 0}
                    onClick={() => setEntered((maxEntered * step) / 100)}
                  />
                ))}
            <QuickButton
              label={buying ? "Max" : "100%"}
              disabled={maxEntered <= 0}
              onClick={() => setEntered(maxEntered)}
            />
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-3 rounded-[13px] bg-wash px-3.5 py-2.5 text-[12.5px] font-semibold">
            <span className="text-faint">
              {buying ? "Available" : `Your ${symbol}`}
            </span>
            <span className="tnum truncate font-extrabold">
              {buying
                ? eth && ethUsd
                  ? `${(book.cashUsd / ethUsd).toFixed(4)} ETH`
                  : money(book.cashUsd)
                : position
                  ? `${units(position.amount)} · ${money(position.valueUsd)}`
                  : "None"}
            </span>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-red">
              {error}
            </p>
          ) : null}
          {filled ? (
            <p
              role="status"
              className="mt-3 text-[12.5px] font-semibold text-green-deep"
            >
              {filled}
            </p>
          ) : null}

          <button
            type="button"
            onClick={confirm}
            disabled={!valid}
            className={cn(
              "mt-4 w-full rounded-[16px] py-[16px] text-[16px] font-extrabold text-white",
              "transition-[transform,opacity] duration-200 hover:-translate-y-0.5",
              "disabled:pointer-events-none disabled:bg-wash disabled:text-faint",
              buying ? "bg-green shadow-green" : "bg-red",
            )}
          >
            {buying ? "Buy" : "Sell"} {symbol}
          </button>

          <p className="mt-2.5 text-center text-[11px] font-medium leading-[1.5] text-faint">
            Max slippage {settings.slippagePct}% · simulated order, no wallet is
            signed and no funds move.
          </p>
        </>
      ) : null}
    </Modal>
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

      <p className="mt-2 text-[11px] font-medium leading-[1.45] text-faint">
        An order fills only if the price stays within this much of the quote.
        Above {MAX_SLIPPAGE_PCT}% is rejected.
      </p>
    </div>
  );
}
