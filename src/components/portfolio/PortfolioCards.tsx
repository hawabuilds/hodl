"use client";

import {useMemo, useState, type ReactNode} from "react";

import {AssetLink} from "@/components/AssetLink";
import {ColumnSegments} from "@/components/desktop/BoardColumn";
import {HoldingAvatar} from "@/components/HoldingsList";
import {EditTargetsDialog, TopUpDialog} from "@/components/allocation/AllocationDialogs";
import {VerifiedTick} from "@/components/ui/Badges";
import {useAllocationTargets} from "@/hooks/useAllocationTargets";
import {useLocalStore} from "@/hooks/useLocalStore";
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
import {money} from "@/lib/format";
import {readHoldingsView, writeHoldingsView, type HoldingsView} from "@/lib/localStore";
import {
  compactAmount,
  donutSlices,
  signedPct,
  signedUsd,
  USDG_KEY,
  type PortfolioRow,
  type RowKind,
} from "@/lib/portfolioView";
import type {Holding} from "@/lib/types";

/**
 * The portfolio page's cards: the stats beside the value chart, the holdings
 * (as a list or a table) and the allocation donut. The page lays them out;
 * these only draw.
 */

export const CARD = "rounded-2xl border border-[var(--overlay-wash)] bg-surface-base";

const LABEL = "text-[11px] font-bold uppercase tracking-[0.09em] text-faint";

/** A placeholder where a number will be once its price is in. */
export function Skel({className}: {className?: string}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block animate-pulse rounded-md bg-[var(--overlay-wash-hover)] align-middle", className)}
    />
  );
}

/** "stale" beside a value priced at its last known price, with when. */
export function StaleMark({at}: {at: string | null}) {
  const when = at ? new Date(at).toLocaleString(undefined, {hour: "numeric", minute: "2-digit", month: "short", day: "numeric"}) : null;
  return (
    <span
      title={when ? `Last known price, from ${when}. Retrying.` : "Last known price. Retrying."}
      className="ml-1.5 rounded px-1 py-px align-middle text-[10px] font-bold uppercase tracking-[0.04em] text-warning ring-1 ring-inset ring-[color-mix(in_srgb,var(--warning)_45%,transparent)]"
    >
      stale
    </span>
  );
}

/** A holding's value: a placeholder while its price loads, never $0 for "no price". */
function RowValue({row}: {row: PortfolioRow}) {
  if (row.priceState === "pending") return <Skel className="h-[15px] w-[68px]" />;
  if (row.priceState === "none") return <span className="text-faint">No price</span>;
  return (
    <>
      {money(row.valueUsd)}
      {row.priceState === "stale" ? <StaleMark at={row.priceAt} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function StatsCard({
  investedUsd,
  ethUsd,
  pnl,
  ready,
  pending = false,
  ethPending = false,
}: {
  investedUsd: number;
  ethUsd: number;
  pnl: {usd: number; pct: number | null} | null;
  /** False until the balances are read: the figures show a dash, not $0. */
  ready: boolean;
  /** A price is still loading: figures that need it show a placeholder. */
  pending?: boolean;
  /** The ETH price is still loading. */
  ethPending?: boolean;
}) {
  const up = (pnl?.usd ?? 0) >= 0;
  const skel = <Skel className="h-[24px] w-[120px]" />;
  return (
    <section aria-label="Portfolio stats" className={cn(CARD, "flex flex-col divide-y divide-[var(--overlay-wash)]")}>
      <Stat label="Invested" value={pending ? skel : ready ? money(investedUsd) : "—"} note="In tokens and RWAs" />
      <Stat label="Buying power" value={ethPending ? skel : ready ? money(ethUsd) : "—"} note="ETH ready to trade" />
      <Stat
        label="Total P&L"
        value={pending ? skel : ready && pnl ? signedUsd(pnl.usd, money) : "—"}
        valueClass={
          !pending && ready && pnl && Math.round(pnl.usd * 100) !== 0 ? (up ? "text-price-up" : "text-price-down") : undefined
        }
        note={
          !ready || pending
            ? " "
            : pnl
              ? pnl.pct == null
                ? "Since your first trade"
                : `${signedPct(pnl.pct)} since your first trade`
              : "Shows after your first trade on HODL"
        }
      />
    </section>
  );
}

function Stat({label, value, note, valueClass}: {label: string; value: ReactNode; note: string; valueClass?: string}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-2.5 [@media(max-height:760px)]:!py-1.5">
      <div className={LABEL}>{label}</div>
      <div className={cn("tabular-nums mt-1 text-[22px] font-extrabold leading-none tracking-[-0.03em] [@media(max-height:760px)]:!text-[20px]", valueClass)}>
        {value}
      </div>
      <div className="mt-1 text-[12.5px] font-medium text-faint [@media(max-height:760px)]:!mt-0.5 [@media(max-height:760px)]:!text-[12px]">{note}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

type Filter = "all" | RowKind;

const EMPTY: Record<Filter, string> = {
  all: "Nothing here yet. Buy from any chart page.",
  token: "No tokens yet. Buy one from any token chart page.",
  rwa: "No tokenized stocks yet. Buy one from any RWA chart page.",
  cash: "No ETH or USDG in this wallet.",
};

export function HoldingsCard({
  rows,
  loading,
  allowTable,
  status,
  pricesPending = false,
}: {
  rows: readonly PortfolioRow[];
  loading: boolean;
  /** Some price is still loading, so shares of the whole are not known yet. */
  pricesPending?: boolean;
  /** A phone only gets the list: five columns do not fit. */
  allowTable: boolean;
  status: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [saved] = useLocalStore<HoldingsView>(readHoldingsView, "list");
  const view = allowTable ? saved : "list";

  const count = (kind: RowKind) => rows.filter((row) => row.kind === kind).length;
  const filters = [
    {value: "all" as const, label: "All", badge: <Count n={rows.length} />},
    {value: "token" as const, label: "Tokens", badge: <Count n={count("token")} />},
    {value: "rwa" as const, label: "RWAs", badge: <Count n={count("rwa")} />},
    {value: "cash" as const, label: "Cash", badge: <Count n={count("cash")} />},
  ];
  const shown = filter === "all" ? rows : rows.filter((row) => row.kind === filter);

  return (
    <section aria-label="Holdings" className={cn(CARD, "flex min-w-0 flex-col")}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 pb-2.5 pt-3.5 lg:px-7 [@media(max-height:760px)]:!pb-2 [@media(max-height:760px)]:!pt-2.5">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em]">Holdings</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <div className="rail -mx-1 overflow-x-auto px-1">
            <ColumnSegments label="Filter holdings" options={filters} value={filter} onChange={setFilter} size="md" />
          </div>
          {allowTable ? (
            <ColumnSegments
              label="Holdings view"
              options={[
                {value: "list" as const, label: "List"},
                {value: "table" as const, label: "Table"},
              ]}
              value={view}
              onChange={writeHoldingsView}
              size="md"
            />
          ) : null}
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <RowsSkeleton />
      ) : shown.length === 0 ? (
        <p className="border-t border-[var(--overlay-wash)] px-6 py-10 text-center text-[13px] leading-[1.5] text-muted">
          {EMPTY[filter]}
        </p>
      ) : view === "table" ? (
        <HoldingsTableView rows={shown} pricesPending={pricesPending} />
      ) : (
        <ul className="border-t border-[var(--overlay-wash)]">
          {shown.map((row) => (
            <li key={row.key} className="border-b border-[var(--overlay-wash)] last:border-b-0">
              <RowLink row={row} className="flex items-center gap-3.5 px-6 py-3 lg:px-7 [@media(max-height:760px)]:!py-2.5">
                <RowAvatar row={row} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">{row.symbol}</span>
                    {row.kind === "rwa" ? <VerifiedTick size={13} /> : null}
                    <Tag row={row} />
                  </div>
                  <div className="tabular-nums mt-[3px] truncate text-[12.5px] font-medium text-faint">
                    {compactAmount(row.amount)} {row.unit ?? row.symbol}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular-nums whitespace-nowrap text-[15px] font-extrabold tracking-[-0.015em]">
                    <RowValue row={row} />
                  </div>
                  <div className="tabular-nums mt-[3px] whitespace-nowrap text-[12.5px] font-semibold">
                    {row.priceState === "pending" ? <Skel className="h-[12px] w-[96px]" /> : <Pnl row={row} joiner=" · " />}
                  </div>
                </div>
              </RowLink>
            </li>
          ))}
        </ul>
      )}
      {status ? <div className="px-6 pb-5 lg:px-7">{status}</div> : null}
    </section>
  );
}

function Count({n}: {n: number}) {
  return <span className="tabular-nums">{n}</span>;
}

const TABLE_COLUMNS =
  "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.35fr)_minmax(128px,1.15fr)] items-center gap-4 px-6 lg:px-7";

function HoldingsTableView({rows, pricesPending}: {rows: readonly PortfolioRow[]; pricesPending: boolean}) {
  return (
    <div className="border-t border-[var(--overlay-wash)]">
      <div aria-hidden="true" className={cn(TABLE_COLUMNS, "border-b border-[var(--overlay-wash)] py-2.5", LABEL)}>
        <span>Asset</span>
        <span>Amount</span>
        <span>Value</span>
        <span>Total P&amp;L</span>
        <span>Allocation</span>
      </div>
      {rows.map((row) => (
        <RowLink
          key={row.key}
          row={row}
          className={cn(TABLE_COLUMNS, "min-h-[66px] border-b border-[var(--overlay-wash)] py-3 text-[14px] last:border-b-0")}
        >
          <span className="flex min-w-0 items-center gap-3">
            <RowAvatar row={row} size={36} />
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[14.5px] font-extrabold tracking-[-0.015em]">{row.symbol}</span>
                {row.kind === "rwa" ? <VerifiedTick size={13} /> : null}
              </span>
              <span className="mt-0.5 block truncate text-[12px] font-medium text-faint">{subtitle(row)}</span>
            </span>
          </span>
          {/* Wraps rather than cutting off: the number always shows whole. */}
          <span className="tabular-nums min-w-0 font-medium leading-[1.35] text-muted [overflow-wrap:anywhere]">
            <span className="whitespace-nowrap">{compactAmount(row.amount)}</span> {row.unit ?? row.symbol}
          </span>
          <span className="tabular-nums whitespace-nowrap font-extrabold">
            <RowValue row={row} />
          </span>
          <span className="tabular-nums whitespace-nowrap font-semibold">
            {row.priceState === "pending" ? <Skel className="h-[13px] w-[110px]" /> : <Pnl row={row} joiner=" " wrap />}
          </span>
          {pricesPending ? (
            <Skel className="h-[13px] w-full max-w-[150px]" />
          ) : (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="tabular-nums w-[44px] shrink-0 font-semibold text-ink">{row.share.toFixed(1)}%</span>
            <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--overlay-wash)]">
              <span
                className="block h-full rounded-full"
                style={{width: `${Math.min(100, row.share)}%`, background: row.color}}
              />
            </span>
          </span>
          )}
        </RowLink>
      ))}
    </div>
  );
}

/** A token or RWA links to its chart; the ETH row is not a page. */
export function RowLink({row, className, children}: {row: PortfolioRow; className: string; children: ReactNode}) {
  if (!row.holding) return <div className={className}>{children}</div>;
  return (
    <AssetLink
      kind={row.holding.kind}
      id={row.holding.assetId}
      className={cn(className, "transition-colors hover:bg-[var(--overlay-wash)]")}
    >
      {children}
    </AssetLink>
  );
}

export function RowAvatar({row, size}: {row: PortfolioRow; size: number}) {
  if (row.holding) return <HoldingAvatar holding={row.holding} size={size} />;
  if (row.key === USDG_KEY) return <UsdMark size={size} />;
  return <EthMark size={size} />;
}

/** The USD cash row's mark, in the same circle as ETH's. */
export function UsdMark({size}: {size: number}) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-500)_18%,var(--surface-raised,#1b1d2b))] font-extrabold text-ink"
      style={{width: size, height: size, fontSize: size * 0.46}}
    >
      $
    </span>
  );
}

export function EthMark({size}: {size: number}) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-500)_18%,var(--surface-raised,#1b1d2b))]"
      style={{width: size, height: size}}
    >
      <svg viewBox="0 0 256 417" style={{height: size * 0.46}} className="text-ink">
        <path fill="currentColor" opacity=".9" d="M127.9 0 125 9.5v275.7l2.9 2.9 127.9-75.6z" />
        <path fill="currentColor" opacity=".6" d="M127.9 0 0 212.5l127.9 75.6V0z" />
        <path fill="currentColor" opacity=".9" d="m127.9 312.2-1.6 1.9v98.1l1.6 4.7L256 236.6z" />
        <path fill="currentColor" opacity=".6" d="M127.9 416.9V312.2L0 236.6z" />
      </svg>
    </span>
  );
}

/** "NVDA" for a token, "RWA" for a stock, "Cash" for ETH and USD. */
export function Tag({row}: {row: PortfolioRow}) {
  const text = row.kind === "cash" ? "Cash" : row.kind === "rwa" ? "RWA" : (row.holding?.pairedTicker ?? null);
  if (!text) return null;
  return (
    <span className="shrink-0 rounded-md bg-[var(--overlay-wash)] px-1.5 py-[2px] text-[10.5px] font-bold tracking-[0.02em] text-muted">
      {text}
    </span>
  );
}

function subtitle(row: PortfolioRow): string {
  if (row.kind === "cash") return row.unit ?? "Cash";
  if (row.kind === "rwa") return row.name;
  return row.holding?.pairedTicker ?? row.name;
}

/** "+$22.10 · +13.8%", or a dash where there is no basis to measure from. */
export function Pnl({row, joiner, wrap = false}: {row: PortfolioRow; joiner: string; wrap?: boolean}) {
  if (row.pnlUsd == null) return <span className="text-faint">—</span>;
  const tone = Math.round(row.pnlUsd * 100) === 0 ? "text-muted" : row.pnlUsd > 0 ? "text-price-up" : "text-price-down";
  const pct = row.pnlPct == null ? null : wrap ? `(${signedPct(row.pnlPct)})` : signedPct(row.pnlPct);
  return (
    <span className={tone}>
      {signedUsd(row.pnlUsd, money)}
      {pct ? `${joiner}${pct}` : null}
    </span>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-hidden className="border-t border-[var(--overlay-wash)]">
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="flex items-center gap-3.5 border-b border-[var(--overlay-wash)] px-6 py-3.5 last:border-b-0 lg:px-7">
          <span className="h-10 w-10 shrink-0 rounded-full bg-wash" />
          <div className="min-w-0 flex-1">
            <span className="block h-3.5 w-20 rounded bg-wash" />
            <span className="mt-2 block h-3 w-28 rounded bg-wash" />
          </div>
          <span className="h-3.5 w-16 rounded bg-wash" />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad)};
}

export function donutArc(cx: number, cy: number, outer: number, inner: number, startDeg: number, endDeg: number): string {
  if (endDeg - startDeg >= 359.99) endDeg = startDeg + 359.99;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const startOuter = polar(cx, cy, outer, startDeg);
  const endOuter = polar(cx, cy, outer, endDeg);
  const startInner = polar(cx, cy, inner, endDeg);
  const endInner = polar(cx, cy, inner, startDeg);
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

/** Degrees of empty space between slices. */
const SLICE_GAP = 1.6;

export function AllocationCard({
  rows,
  holdings,
  loading,
  pending = false,
}: {
  rows: readonly PortfolioRow[];
  /** Tokens and RWAs: what targets are set on (ETH is what buys them). */
  holdings: readonly Holding[];
  loading: boolean;
  /** A price is still loading: the shares are not known yet. */
  pending?: boolean;
}) {
  const saved = useAllocationTargets();
  const [editOpen, setEditOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const keys = useMemo(() => pricedHoldings(holdings).map(allocationKey), [holdings]);
  const hasSaved = keys.some((key) => saved.targets[key] != null);
  const targets = useMemo(
    () => (hasSaved ? normalizeTargets(saved.targets, keys) : {}),
    [hasSaved, keys, saved.targets],
  );
  const targetsOn = hasSaved && targetsValid(targets);
  const score = targetsOn ? rebalanceScore(drift(holdings, targets)) : 0;
  const needsRebalance = targetsOn && score >= REBALANCE_THRESHOLD_PCT;

  const slices = useMemo(() => donutSlices(rows), [rows]);
  const arcs = useMemo(() => {
    let cursor = 0;
    const gap = slices.length > 1 ? SLICE_GAP : 0;
    return slices.map((slice) => {
      const sweep = (slice.share / 100) * 360;
      const start = cursor + gap / 2;
      const end = Math.max(start + 0.4, cursor + sweep - gap / 2);
      cursor += sweep;
      return {slice, path: donutArc(100, 100, 92, 64, start, end)};
    });
  }, [slices]);
  const focus = slices.find((slice) => slice.key === active) ?? null;
  const held = rows.length;

  return (
    <section aria-label="Allocation" className={cn(CARD, "flex min-w-0 flex-col px-6 pb-6 pt-5")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em]">Allocation</h2>
        <div className="flex shrink-0 items-center gap-2">
          {needsRebalance ? (
            <button
              type="button"
              onClick={() => setTopUpOpen(true)}
              className="min-h-[32px] rounded-full bg-brand-500 px-3.5 text-[12.5px] font-extrabold text-white transition-colors hover:bg-brand-600"
            >
              Rebalance
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            disabled={holdings.length === 0}
            className="min-h-[34px] rounded-full bg-[var(--overlay-wash)] px-4 text-[13px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)] disabled:opacity-45"
          >
            Edit targets
          </button>
        </div>
      </div>
      {targetsOn ? (
        <p className="mt-1.5 text-[12.5px] font-semibold text-faint">
          {needsRebalance
            ? `Off target by up to ${score.toFixed(1)} points`
            : `Within ${REBALANCE_THRESHOLD_PCT}% of your targets`}
        </p>
      ) : null}

      {(loading && rows.length === 0) || pending ? (
        <div aria-label="Loading prices">
          <div className="mx-auto mt-5 h-[184px] w-[184px] animate-pulse rounded-full border-[28px] border-[var(--overlay-wash-hover)]" />
          <ul aria-hidden="true" className="mt-6 space-y-3 px-2">
            {Array.from({length: Math.max(2, Math.min(rows.length, 7))}, (_, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <Skel className="h-2.5 w-2.5 rounded-full" />
                <Skel className="h-[13px] w-[72px]" />
                <span className="flex-1" />
                <Skel className="h-[13px] w-[44px]" />
                <Skel className="h-[13px] w-[60px]" />
              </li>
            ))}
          </ul>
        </div>
      ) : slices.length === 0 ? (
        <p className="mx-auto my-10 max-w-[30ch] text-center text-[12.5px] leading-[1.5] text-faint">
          Your allocation shows here once you hold something with a live price.
        </p>
      ) : (
        <>
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={`Allocation: ${slices.map((slice) => `${slice.label} ${slice.share.toFixed(1)}%`).join(", ")}`}
            className="mx-auto mt-5 block h-[184px] w-[184px]"
          >
            {arcs.map(({slice, path}) => (
              <path
                key={slice.key}
                d={path}
                fill={slice.color}
                opacity={active == null || active === slice.key ? 1 : 0.35}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => setActive(slice.key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(slice.key)}
              >
                <title>
                  {slice.label} · {slice.share.toFixed(1)}%
                </title>
              </path>
            ))}
            <text x={100} y={100} textAnchor="middle" className="fill-ink font-extrabold" style={{fontSize: focus ? 20 : 26}}>
              {focus ? focus.label : held}
            </text>
            <text x={100} y={121} textAnchor="middle" className="fill-muted font-semibold" style={{fontSize: 12}}>
              {focus ? `${focus.share.toFixed(1)}%` : held === 1 ? "holding" : "holdings"}
            </text>
          </svg>

          <ul className="mt-6 space-y-0.5" aria-label="Allocation by holding">
            {slices.map((slice) => (
              <li
                key={slice.key}
                onMouseEnter={() => setActive(slice.key)}
                onMouseLeave={() => setActive(null)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2 py-[5px] text-[13.5px] transition-colors",
                  active === slice.key && "bg-[var(--overlay-wash)]",
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: slice.color}} />
                <span className="min-w-0 flex-1 truncate font-extrabold text-ink">
                  {slice.label}
                  {slice.count ? <span className="font-semibold text-faint"> · {slice.count}</span> : null}
                </span>
                <span className="tabular-nums w-[52px] shrink-0 text-right font-semibold text-ink">
                  {slice.share.toFixed(1)}%
                </span>
                <span className="tabular-nums min-w-[64px] shrink-0 whitespace-nowrap text-right font-medium text-faint">
                  {money(slice.valueUsd)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <EditTargetsDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        holdings={holdings}
        initialTargets={saved.targets}
        onSave={saved.save}
      />
      <TopUpDialog open={topUpOpen} onClose={() => setTopUpOpen(false)} holdings={holdings} targets={targets} />
    </section>
  );
}
