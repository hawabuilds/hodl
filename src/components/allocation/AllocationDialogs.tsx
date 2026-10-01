"use client";

import {useEffect, useMemo, useState, type ReactNode} from "react";

import {useIsDesktop} from "@/hooks/useBreakpoint";
import {useTopUp, type PlannedLeg} from "@/hooks/useTopUp";
import {
  allocationKey,
  equalTargets,
  pricedHoldings,
  targetsFromActual,
  targetsValid,
} from "@/lib/allocation";
import {cn} from "@/lib/cn";
import {money} from "@/lib/format";
import type {Holding} from "@/lib/types";
import {TokenAvatar} from "../ui/TokenAvatar";
import {useTokenLaunchpad} from "@/hooks/useTokenLaunchpad";
import {Modal} from "../ui/Modal";
import {Sheet, SheetTitle} from "../ui/Sheet";

/** A centred dialog on a desktop, a bottom sheet on a phone. */
function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <Modal open={open} onClose={onClose} title={title} className="max-w-[440px] p-6">
        {children}
      </Modal>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} height="auto" label={title} header={<SheetTitle title={title} onClose={onClose} />}>
      <div className="pt-3">{children}</div>
    </Sheet>
  );
}

const chip =
  "rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)] disabled:opacity-50";
const primary =
  "min-h-[44px] w-full rounded-xl bg-brand-500 px-4 text-[14px] font-extrabold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45";
const secondary =
  "min-h-[44px] w-full rounded-xl bg-[var(--overlay-wash)] px-4 text-[14px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)] disabled:opacity-45";

// ── Edit targets ─────────────────────────────────────────────────────────────

export function EditTargetsDialog({
  open,
  onClose,
  holdings,
  initialTargets,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  holdings: readonly Holding[];
  initialTargets: Record<string, number>;
  onSave: (targets: Record<string, number>) => Promise<void>;
}) {
  const priced = useMemo(
    () => [...pricedHoldings(holdings)].sort((a, b) => b.valueUsd - a.valueUsd),
    [holdings],
  );
  const keys = useMemo(() => priced.map(allocationKey), [priced]);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Saved targets for what is held now; a new holding starts at zero.
    const saved = keys.some((key) => initialTargets[key] != null);
    setDraft(saved ? Object.fromEntries(keys.map((key) => [key, initialTargets[key] ?? 0])) : targetsFromActual(priced));
  }, [open, initialTargets, keys, priced]);

  const total = keys.reduce((sum, key) => sum + (draft[key] ?? 0), 0);
  const valid = targetsValid(Object.fromEntries(keys.map((key) => [key, draft[key] ?? 0])));
  const setWeight = (key: string, next: number) =>
    setDraft((current) => ({...current, [key]: Math.max(0, Math.min(100, Number.isFinite(next) ? next : 0))}));

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(Object.fromEntries(keys.map((key) => [key, Math.round((draft[key] ?? 0) * 10) / 10])));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save your targets.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Edit targets">
      {priced.length === 0 ? (
        <p className="text-[13px] leading-[1.5] text-muted">Hold something with a live price to set targets.</p>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <button type="button" className={chip} onClick={() => setDraft(equalTargets(keys))}>
              Equal weight
            </button>
            <button type="button" className={chip} onClick={() => setDraft(targetsFromActual(priced))}>
              Match current
            </button>
          </div>
          <ul className="max-h-[min(48vh,380px)] space-y-3 overflow-y-auto pr-1 scroll-quiet">
            {priced.map((holding) => {
              const key = allocationKey(holding);
              const value = draft[key] ?? 0;
              return (
                <li key={key}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <HoldingLogo holding={holding} seed={key} size={22} />
                      <span className="truncate text-[14px] font-extrabold">{holding.symbol}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step={0.1}
                        value={Number.isFinite(value) ? value : 0}
                        onChange={(event) => setWeight(key, Number(event.target.value))}
                        aria-label={`${holding.symbol} target percent`}
                        className="tabular-nums h-9 w-16 rounded-lg bg-[var(--overlay-wash)] px-2 text-right text-[13px] max-lg:text-[16px] font-bold text-ink outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <span className="text-[12px] font-semibold text-faint">%</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    value={value}
                    onChange={(event) => setWeight(key, Number(event.target.value))}
                    aria-label={`${holding.symbol} target`}
                    className="h-6 w-full accent-[var(--brand-500)]"
                  />
                </li>
              );
            })}
          </ul>
          <p className={cn("tabular-nums mt-4 text-center text-[13px] font-bold", valid ? "text-muted" : "text-price-down")}>
            Total {total.toFixed(1)}%{valid ? "" : " · must add up to 100%"}
          </p>
          {error ? <p className="mt-2 text-center text-[12.5px] font-semibold text-price-down">{error}</p> : null}
          <button type="button" className={cn(primary, "mt-4")} disabled={!valid || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save targets"}
          </button>
        </>
      )}
    </Dialog>
  );
}

// ── Top up ───────────────────────────────────────────────────────────────────

function LegRow({leg}: {leg: PlannedLeg}) {
  const {state} = leg;
  const note =
    state.kind === "checking"
      ? "Checking…"
      : state.kind === "skip"
        ? `Skipped · ${state.reason}`
        : state.kind === "running"
          ? state.text
          : state.kind === "done"
            ? "Done"
            : state.kind === "failed"
              ? `Failed · ${state.reason}`
              : null;
  return (
    <li className={cn("flex items-center gap-2.5 rounded-xl px-2 py-2", state.kind === "skip" && "opacity-60")}>
      <HoldingLogo holding={leg.holding} seed={leg.key} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-extrabold">Buy {leg.holding.symbol}</span>
          {state.kind === "done" ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--price-up)_16%,transparent)] px-1.5 py-0.5 text-[10.5px] font-bold text-price-up">
              Done
            </span>
          ) : null}
        </div>
        {note && state.kind !== "done" ? (
          <div
            className={cn(
              "truncate text-[12px] font-semibold",
              state.kind === "failed" ? "text-price-down" : state.kind === "running" ? "text-accent-link" : "text-faint",
            )}
            title={note}
          >
            {note}
          </div>
        ) : null}
      </div>
      <span className="tabular-nums shrink-0 text-[13px] font-bold text-muted">{money(leg.amountUsd)}</span>
    </li>
  );
}

export function TopUpDialog({
  open,
  onClose,
  holdings,
  targets,
}: {
  open: boolean;
  onClose: () => void;
  holdings: readonly Holding[];
  targets: Record<string, number>;
}) {
  const topUp = useTopUp({open, holdings, targets});
  const close = topUp.running ? () => {} : onClose;
  const available = topUp.available;

  return (
    <Dialog open={open} onClose={close} title="Rebalance">
      <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Mode">
        <span role="radio" aria-checked="true" className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-extrabold text-surface-base">
          Top up only
        </span>
        <span
          role="radio"
          aria-checked="false"
          aria-disabled="true"
          title="Coming next"
          className="rounded-full border border-[var(--overlay-wash-hover)] px-3 py-1.5 text-[12px] font-bold text-faint"
        >
          Buy and sell · soon
        </span>
      </div>
      <p className="mb-3 text-[12.5px] leading-[1.5] text-muted">
        Spend ETH on the holdings below their targets, in proportion to how far under they are. Nothing is sold.
      </p>

      <label className="flex h-12 items-center gap-2 rounded-xl bg-[var(--overlay-wash)] px-3.5 focus-within:ring-2 focus-within:ring-brand-500">
        <span className="text-[15px] font-bold text-faint">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={topUp.amountText}
          disabled={topUp.running}
          onChange={(event) => topUp.setAmountText(event.target.value)}
          placeholder="Amount to add"
          aria-label="Amount in dollars"
          className="tabular-nums min-w-0 flex-1 bg-transparent text-[16px] font-bold text-ink outline-none placeholder:text-faint"
        />
        {available != null && available > 0 ? (
          <button
            type="button"
            disabled={topUp.running}
            onClick={() => topUp.setAmountText(String(Math.floor(available)))}
            className="rounded-lg bg-[var(--overlay-wash-hover)] px-2.5 py-1 text-[12px] font-extrabold text-ink"
          >
            Max
          </button>
        ) : null}
      </label>
      <p className={cn("mt-1.5 text-[12px] font-semibold", topUp.overBudget ? "text-price-down" : "text-faint")}>
        {!topUp.hasWallet
          ? "Sign in to buy from your wallet."
          : available == null
            ? "Reading your ETH balance…"
          : topUp.overBudget
            ? `Only ${money(available)} of ETH is free after gas.`
            : `${money(available)} of ETH free after gas.`}
      </p>

      <ul className="mt-3 max-h-[min(40vh,300px)] space-y-0.5 overflow-y-auto scroll-quiet" aria-label="Planned buys">
        {topUp.legs.length === 0 ? (
          <li className="py-5 text-center text-[13px] text-faint">
            {topUp.amountUsd > 0 ? "Nothing is under its target." : "Enter an amount to see the buys."}
          </li>
        ) : (
          topUp.legs.map((leg) => <LegRow key={leg.key} leg={leg} />)
        )}
      </ul>

      {topUp.stopped ? (
        <div className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--price-down)_12%,transparent)] px-3.5 py-3">
          <p className="text-[13px] font-extrabold text-ink">
            Done {topUp.stopped.done} of {topUp.stopped.of} — resume?
          </p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">{topUp.stopped.reason}</p>
          <button type="button" className={cn(secondary, "mt-2.5")} onClick={() => void topUp.resume()}>
            Resume with a fresh plan
          </button>
        </div>
      ) : topUp.finished ? (
        <p className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--price-up)_12%,transparent)] px-3.5 py-3 text-[13px] font-extrabold">
          Top up done: {topUp.finished.done} {topUp.finished.done === 1 ? "buy" : "buys"} for {money(topUp.finished.spentUsd)}.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={secondary} disabled={topUp.running} onClick={onClose}>
          {topUp.running ? "Working…" : "Close"}
        </button>
        <button
          type="button"
          className={primary}
          disabled={topUp.running || topUp.readyCount === 0 || topUp.overBudget || topUp.stopped != null}
          onClick={() => void topUp.execute()}
        >
          {topUp.running
            ? "Buying…"
            : topUp.readyCount > 0
              ? `Buy ${topUp.readyCount} ${topUp.readyCount === 1 ? "holding" : "holdings"}`
              : "Buy"}
        </button>
      </div>
      <p className="mt-2.5 text-center text-[11.5px] font-medium text-faint">
        Each buy is confirmed in your wallet, one at a time.
      </p>
    </Dialog>
  );
}

/** A holding's picture, with its launchpad badge when it is a token. */
function HoldingLogo({holding, seed, size}: {holding: Holding; seed: string; size: number}) {
  const launchpad = useTokenLaunchpad(holding.kind === "token" ? holding.assetId : null);
  return <TokenAvatar launchpad={launchpad} name={holding.symbol} src={holding.logoUrl} seed={seed} size={size} />;
}
