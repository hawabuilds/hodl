"use client";

import {useEffect, useMemo, useState} from "react";
import {useBook} from "@/hooks/useBook";
import {cn} from "@/lib/cn";
import {money, price as fmtPrice, units} from "@/lib/format";
import type {Asset} from "@/lib/types";
import {Sheet, SheetTitle} from "./ui/Sheet";

const QUICK_AMOUNTS = [25, 100, 500];

/**
 * Buy and sell.
 *
 * The fill is simulated and recorded against the local book — nothing here
 * signs a transaction or moves funds, and the sheet says so above the confirm
 * button rather than in fine print somewhere else. The validation is real,
 * though: insufficient cash and oversized sells fail here exactly as they would
 * against a router, so wiring one in later does not change this component.
 */
export function OrderSheet({
  asset,
  side,
  onClose,
}: {
  asset: Asset | null;
  side: "buy" | "sell";
  onClose: () => void;
}) {
  const book = useBook();
  const [activeSide, setActiveSide] = useState(side);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);

  const symbol = asset?.kind === "rwa" ? asset.ticker : asset?.symbol ?? "";
  const position = book.holdings.find((h) => h.assetId === asset?.id);

  useEffect(() => {
    setActiveSide(side);
    setAmount("");
    setError(null);
    setFilled(null);
  }, [side, asset?.id]);

  const amountUsd = Number.parseFloat(amount);
  const valid = Number.isFinite(amountUsd) && amountUsd > 0;

  const maxUsd =
    activeSide === "buy" ? book.cashUsd : (position?.valueUsd ?? 0);

  const estimatedUnits = useMemo(() => {
    if (!asset || !valid || asset.priceUsd <= 0) return 0;
    return amountUsd / asset.priceUsd;
  }, [asset, amountUsd, valid]);

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
      `${activeSide === "buy" ? "Bought" : "Sold"} ${units(result.order?.amount ?? 0)} ${symbol}`,
    );
    setAmount("");
  }

  const buying = activeSide === "buy";

  return (
    <Sheet
      open={asset !== null}
      onClose={onClose}
      height="auto"
      label={`${buying ? "Buy" : "Sell"} ${symbol}`}
      header={<SheetTitle title={`${buying ? "Buy" : "Sell"} ${symbol}`} onClose={onClose} />}
    >
      {asset ? (
        <div className="pb-2">
          <div className="mb-4 flex gap-0.5 rounded-[12px] border border-hairline bg-wash p-[3px]">
            {(["buy", "sell"] as const).map((option) => {
              const active = option === activeSide;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setActiveSide(option);
                    setError(null);
                    setFilled(null);
                  }}
                  className={cn(
                    "flex-1 rounded-[9px] py-2 text-[13px] font-extrabold capitalize transition-all duration-150",
                    active && option === "buy" && "bg-green text-white shadow-green",
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
            Amount in US dollars
          </label>
          <div className="rounded-panel border border-hairline bg-card px-4 py-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-extrabold text-faint">$</span>
              <input
                id="order-amount"
                // `decimal` rather than `numeric`: a dollar amount needs the
                // point, and `numeric` hides it on iOS.
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^0-9.]/g, "");
                  // One decimal point, and never more than two places.
                  const parts = next.split(".");
                  setAmount(
                    parts.length > 1
                      ? `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`
                      : parts[0],
                  );
                  setError(null);
                  setFilled(null);
                }}
                className="tnum w-full min-w-0 border-none bg-transparent text-[34px] font-extrabold tracking-[-0.03em] text-ink outline-none placeholder:text-faint"
              />
            </div>
            <div className="tnum mt-1 text-[12.5px] font-semibold text-faint">
              {valid && asset.priceUsd > 0
                ? `≈ ${units(estimatedUnits)} ${symbol} at ${fmtPrice(asset.priceUsd)}`
                : `${fmtPrice(asset.priceUsd)} per ${symbol}`}
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
            {QUICK_AMOUNTS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={value > maxUsd}
                onClick={() => {
                  setAmount(String(value));
                  setError(null);
                  setFilled(null);
                }}
                className="flex-1 rounded-pill border border-hairline bg-card py-2.5 text-[12.5px] font-bold text-ink transition-colors hover:border-[var(--border-hover-strong)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ${value}
              </button>
            ))}
            <button
              type="button"
              disabled={maxUsd <= 0}
              onClick={() => {
                setAmount(maxUsd.toFixed(2));
                setError(null);
                setFilled(null);
              }}
              className="flex-1 rounded-pill border border-hairline bg-card py-2.5 text-[12.5px] font-bold text-ink transition-colors hover:border-[var(--border-hover-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Max
            </button>
          </div>

          <div className="mt-3.5 flex items-center justify-between rounded-[13px] bg-wash px-3.5 py-2.5 text-[12.5px] font-semibold">
            <span className="text-faint">
              {buying ? "Simulated cash" : `Your ${symbol}`}
            </span>
            <span className="tnum font-extrabold">
              {buying
                ? money(book.cashUsd)
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
            <p role="status" className="mt-3 text-[12.5px] font-semibold text-green-deep">
              {filled}
            </p>
          ) : null}

          <button
            type="button"
            onClick={confirm}
            disabled={!valid}
            className={cn(
              "mt-4 w-full rounded-[16px] py-[17px] text-[16px] font-extrabold text-white",
              "transition-[transform,opacity] duration-200 hover:-translate-y-0.5",
              "disabled:pointer-events-none disabled:bg-wash disabled:text-faint",
              buying ? "bg-green shadow-green" : "bg-red",
            )}
          >
            {buying ? "Buy" : "Sell"} {symbol}
          </button>

          <p className="mt-3 text-center text-[11.5px] font-medium leading-[1.5] text-faint">
            Simulated order. No wallet is signed and no funds move — this updates
            your local book only.
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}
