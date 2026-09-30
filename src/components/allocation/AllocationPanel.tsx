"use client";

import {useMemo, useState} from "react";

import {useAllocationTargets} from "@/hooks/useAllocationTargets";
import {
  REBALANCE_THRESHOLD_PCT,
  allocationKey,
  drift,
  normalizeTargets,
  pricedHoldings,
  rebalanceScore,
  targetsValid,
} from "@/lib/allocation";
import {cn} from "@/lib/cn";
import type {Holding} from "@/lib/types";
import {AllocationChart} from "./AllocationChart";
import {EditTargetsDialog, TopUpDialog} from "./AllocationDialogs";

/**
 * Portfolio → Allocation: the donut, how far each holding is from its
 * target, and the two actions — Edit targets and Rebalance (top up only for
 * now). A panel beside Holdings on a desktop; the chart area's second view on
 * a phone.
 */
export function AllocationPanel({
  holdings,
  loading,
  layout,
  title = true,
}: {
  holdings: readonly Holding[];
  loading: boolean;
  layout: "desktop" | "phone";
  /** Off when a tab above already says "Allocation". */
  title?: boolean;
}) {
  const saved = useAllocationTargets();
  const [editOpen, setEditOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const keys = useMemo(() => pricedHoldings(holdings).map(allocationKey), [holdings]);
  // Saved targets, for what is held now, scaled to 100%: a holding sold since
  // drops out, and a new one counts as a zero target.
  const hasSaved = keys.some((key) => saved.targets[key] != null);
  const targets = useMemo(
    () => (hasSaved ? normalizeTargets(saved.targets, keys) : {}),
    [hasSaved, keys, saved.targets],
  );
  const active = hasSaved && targetsValid(targets);
  const rows = useMemo(() => drift(holdings, targets), [holdings, targets]);
  const score = active ? rebalanceScore(rows) : 0;

  const editButton = (
    <button
      type="button"
      onClick={() => setEditOpen(true)}
      disabled={keys.length === 0}
      className="min-h-[36px] rounded-full bg-[var(--overlay-wash)] px-3.5 text-[12.5px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)] disabled:opacity-45"
    >
      Edit targets
    </button>
  );

  const needsRebalance = active && score >= REBALANCE_THRESHOLD_PCT;
  const rebalanceButton = needsRebalance ? (
    <button
      type="button"
      onClick={() => setTopUpOpen(true)}
      className="min-h-[36px] rounded-full bg-brand-500 px-4 text-[13px] font-extrabold text-white shadow-brand transition-colors hover:bg-brand-600"
    >
      Rebalance
    </button>
  ) : null;
  const note = needsRebalance ? (
    <p className="text-[12.5px] font-semibold text-faint">
      Off target by up to {score.toFixed(1)} points
    </p>
  ) : active ? (
    <p className="text-[12.5px] font-semibold text-faint">Within {REBALANCE_THRESHOLD_PCT}% of your targets</p>
  ) : keys.length > 0 ? (
    <p className="text-[12.5px] font-medium leading-[1.45] text-faint">Set targets to see how far each holding is from them.</p>
  ) : null;

  return (
    <div className={cn("flex min-h-0 flex-col", layout === "desktop" && "h-full")}>
      {layout === "desktop" ? (
        <div className="shrink-0 px-[18px] pb-2">
          {/* The actions stay at the top, above the scrolling legend. */}
          <div className="flex items-center justify-between gap-3">
            {title ? <h2 className="text-[15px] font-extrabold tracking-[-0.02em]">Allocation</h2> : note}
            <div className="flex shrink-0 items-center gap-2">
              {editButton}
              {rebalanceButton}
            </div>
          </div>
          {title ? <div className="mt-1">{note}</div> : null}
        </div>
      ) : null}

      <div className={cn(layout === "desktop" && "scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 pb-4")}>
        {/* A readable width however wide the panel is. */}
        <div className={cn(layout === "desktop" && "mx-auto w-full max-w-[560px]")}>
        {loading && holdings.length === 0 ? (
          <div className="mx-auto my-6 h-[160px] w-[160px] animate-pulse rounded-full border-[26px] border-[var(--overlay-wash)]" />
        ) : (
          <AllocationChart
            holdings={holdings}
            targets={targets}
            targetsActive={active}
            driftRows={rows}
            donutHeight={layout === "desktop" ? 168 : 164}
          />
        )}
        {layout === "phone" ? (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              {editButton}
              {rebalanceButton}
            </div>
            <div className="mt-2">{note}</div>
          </div>
        ) : null}
        </div>
      </div>

      <EditTargetsDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        holdings={holdings}
        initialTargets={saved.targets}
        onSave={saved.save}
      />
      <TopUpDialog open={topUpOpen} onClose={() => setTopUpOpen(false)} holdings={holdings} targets={targets} />
    </div>
  );
}
