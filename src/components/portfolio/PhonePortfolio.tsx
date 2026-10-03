"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {HoldingsSkeleton} from "@/components/HoldingsList";
import {PillRail} from "@/components/PillRail";
import {PriceChart} from "@/components/PriceChart";
import {SettingsMenu} from "@/components/SettingsMenu";
import {ShareProfileButton} from "@/components/ShareProfileButton";
import {SocialRow} from "@/components/SocialRow";
import {EditTargetsDialog, TopUpDialog} from "@/components/allocation/AllocationDialogs";
import {Pnl, RowAvatar, RowLink, Skel, StaleMark, Tag, donutArc} from "@/components/portfolio/PortfolioCards";
import {Avatar} from "@/components/ui/Avatar";
import {VerifiedTick} from "@/components/ui/Badges";
import {useAllocationTargets} from "@/hooks/useAllocationTargets";
import {useMe} from "@/hooks/useMe";
import {useMyFollowers, usePeople} from "@/hooks/usePeople";
import {usePortfolio} from "@/hooks/usePortfolio";
import {useFollows} from "@/hooks/useProfile";
import {useUser} from "@/hooks/useUser";
import {useWallet} from "@/hooks/useWallet";
import {allocationKey, normalizeTargets, pricedHoldings, targetsValid} from "@/lib/allocation";
import {cn} from "@/lib/cn";
import {compact, money, shortAddress} from "@/lib/format";
import {buildRows, compactAmount, donutSlices, type DonutSlice, type PortfolioRow} from "@/lib/portfolioView";
import {PORTFOLIO_RANGES, type ChartPoint, type PortfolioRange} from "@/lib/types";

/**
 * Portfolio on a phone: the profile, the value, then a Trend tab (chart and
 * holdings) or an Allocation tab (donut and targets). The numbers are the
 * desktop's — ETH is a holding tagged "Cash" and sits in the donut, so the
 * shares add up to 100%.
 */

/** What the change under the total covers, for each chart range. */
const RANGE_NOTE: Record<PortfolioRange, string> = {
  "1H": "past hour",
  "1D": "today",
  "1W": "past week",
  "1M": "past month",
  "1Y": "past year",
  ALL: "all time",
};

type Tab = "trend" | "allocation";

export function PhonePortfolio() {
  const me = useMe();
  const {embeddedWallet} = useUser();
  const imported = useWallet();
  const activeWallet =
    (imported.isConnected ? imported.address : null) ?? embeddedWallet ?? me.wallet;
  const [range, setRange] = useState<PortfolioRange>("1D");
  const book = usePortfolio(range);
  const [tab, setTab] = useState<Tab>("trend");
  // `?view=allocation` (the Home banner's "Rebalance" slide) opens on allocation.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") !== "allocation") return;
    setTab("allocation");
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [connections, setConnections] = useState<"followers" | "following" | null>(null);
  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);
  const connectionsAnchor = connections === "following" ? followingRef : followersRef;

  const follows = useFollows();
  // Loaded up front rather than on open, so the count beside the label is the
  // length of the list the sheet actually shows.
  const followers = useMyFollowers();
  const following = usePeople(follows.following, connections === "following");

  const points: ChartPoint[] = book.points;
  // While a price is still loading the total is incomplete, so up or down
  // follows the saved history rather than a drop that is not real.
  const positive = book.pricesPending
    ? (book.points.at(-1)?.price ?? 0) >= (book.points[0]?.price ?? 0)
    : book.changePct >= 0;
  const shownValue = scrubbed?.price ?? book.totalValue;
  const openValue = points[0]?.price ?? book.totalValue;
  const shownChangeUsd = scrubbed ? scrubbed.price - openValue : book.changeUsd;
  const shownChangePct = openValue > 0 ? (shownChangeUsd / openValue) * 100 : 0;
  const ready = book.nativeReady || book.tokensReady;

  const rows = useMemo(
    () => buildRows(book.holdings, book.ethBalance, book.ethValueUsd, book.ethPending),
    [book.holdings, book.ethBalance, book.ethValueUsd, book.ethPending],
  );

  // Targets are set on tokens and RWAs; ETH is what buys them.
  const saved = useAllocationTargets();
  const keys = useMemo(() => pricedHoldings(book.holdings).map(allocationKey), [book.holdings]);
  const hasSaved = keys.some((key) => saved.targets[key] != null);
  const targets = useMemo(
    () => (hasSaved ? normalizeTargets(saved.targets, keys) : {}),
    [hasSaved, keys, saved.targets],
  );
  const targetsOn = hasSaved && targetsValid(targets);

  const statusNote = book.error ? (
    <p className="mt-5 text-[13px] leading-[1.5] text-error">
      Couldn&apos;t load your balances. Pull to refresh and try again.
    </p>
  ) : book.degraded ? (
    <p className="mt-5 text-[11.5px] leading-[1.5] text-faint">
      Balances could not be read just now, so this may be incomplete.
    </p>
  ) : !book.connected ? (
    <p className="mt-5 text-[11.5px] leading-[1.5] text-faint">Connect a wallet to see what you hold.</p>
  ) : null;

  return (
    // The bottom pad clears the floating nav bar and the home indicator.
    <div className={cn(APP_SCROLL_PAD_TOP, "pb-[calc(56px+env(safe-area-inset-bottom,0px))]")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar name={me.displayName} src={me.pfpUrl} size={56} ring />
          <div className="min-w-0">
            <div className="truncate text-[20px] font-extrabold tracking-[-0.03em]">{me.displayName}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-faint">
              <span className="truncate">{me.handle ? `@${me.handle}` : "Signed in"}</span>
              {activeWallet ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{shortAddress(activeWallet, 4)}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <SocialRow socials={me.socials} />
          <SettingsMenu />
        </div>
      </div>

      {me.bio ? <p className="mt-3 text-[13.5px] leading-[1.5] text-muted">{me.bio}</p> : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 whitespace-nowrap text-[13.5px] font-medium text-faint">
          <button
            ref={followersRef}
            type="button"
            onClick={() => setConnections((prev) => (prev === "followers" ? null : "followers"))}
            className="transition-colors hover:text-accent-link"
          >
            <b className="tabular-nums font-extrabold text-ink">{compact(followers.followers.length)}</b> followers
          </button>
          <button
            ref={followingRef}
            type="button"
            onClick={() => setConnections((prev) => (prev === "following" ? null : "following"))}
            className="transition-colors hover:text-accent-link"
          >
            <b className="tabular-nums font-extrabold text-ink">{follows.following.length}</b> following
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {me.handle ? (
            <ShareProfileButton
              handle={me.handle}
              title={me.displayName}
              className="h-10 w-10 bg-[var(--overlay-wash)] text-ink"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="min-h-[40px] rounded-full bg-[var(--overlay-wash)] px-4 text-[14px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
          >
            Edit profile
          </button>
        </div>
      </div>

      <div className="mt-6 text-[11px] font-bold uppercase tracking-[0.09em] text-faint">Portfolio value</div>
      <div className="tabular-nums mt-1.5 text-[40px] font-extrabold leading-none tracking-[-0.035em]">
        {book.pricesPending ? (
          <Skel className="h-[40px] w-[200px]" />
        ) : ready ? (
          book.holdings.length > 0 && shownValue <= 0 ? "—" : money(shownValue)
        ) : (
          "—"
        )}
      </div>
      <div className="tabular-nums mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[14px] font-bold">
        {book.pricesPending ? (
          <Skel className="h-[14px] w-[200px]" />
        ) : ready ? (
          <>
            <span className={shownChangeUsd >= 0 ? "text-price-up" : "text-price-down"}>
              <span aria-hidden="true" className="mr-1 text-[0.85em]">
                {shownChangeUsd >= 0 ? "▲" : "▼"}
              </span>
              {money(Math.abs(shownChangeUsd))} ({Math.abs(shownChangePct).toFixed(1)}%)
            </span>
            <span className="text-muted">{scrubbed ? "since start" : RANGE_NOTE[range]}</span>
            {book.ethBalance > 0 ? (
              <span className="text-muted">· {compactAmount(book.ethBalance)} ETH</span>
            ) : null}
          </>
        ) : (
          " "
        )}
      </div>

      {book.connected ? (
        <>
          <div className="mt-4 flex items-center gap-2">
            <TabButton active={tab === "trend"} onClick={() => setTab("trend")}>
              Trend
            </TabButton>
            <TabButton active={tab === "allocation"} onClick={() => setTab("allocation")}>
              Allocation
            </TabButton>
            {tab === "allocation" ? (
              <button
                type="button"
                onClick={() => setTargetsOpen(true)}
                disabled={keys.length === 0}
                className="ml-auto min-h-[38px] rounded-full bg-[var(--overlay-wash)] px-4 text-[14px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)] disabled:opacity-45"
              >
                Edit targets
              </button>
            ) : null}
          </div>

          {tab === "trend" ? (
            <>
              {/* Edge to edge: the line runs the full width of the screen. */}
              <div className="-mx-[22px] mt-4">
                <PriceChart
                  points={points}
                  height={170}
                  positive={positive}
                  onScrub={setScrubbed}
                  bare
                  fitKey={`${range}:${points[0]?.t ?? ""}`}
                />
              </div>
              <PillRail
                label="Portfolio range"
                options={PORTFOLIO_RANGES}
                value={range}
                onChange={setRange}
                positive={positive}
                className="mt-3 justify-between"
              />

              <h2 className="mt-6 text-[18px] font-extrabold tracking-[-0.02em]">Holdings</h2>
              {book.isLoading && rows.length === 0 ? (
                <div className="mt-2">
                  <HoldingsSkeleton />
                </div>
              ) : rows.length === 0 ? (
                <p className="py-8 text-center text-[13px] leading-[1.5] text-muted">
                  Nothing here yet. Buy from any chart page.
                </p>
              ) : (
                <PhoneHoldings rows={rows} />
              )}
            </>
          ) : (
            <PhoneAllocation
              rows={rows}
              loading={book.isLoading || book.pricesPending}
              targets={targetsOn ? targets : null}
              onRebalance={() => setTopUpOpen(true)}
            />
          )}
        </>
      ) : null}

      {statusNote}

      <ConnectionsSheet
        open={connections !== null}
        anchorRef={connectionsAnchor}
        title={connections === "following" ? "Following" : "Followers"}
        people={connections === "following" ? following.people : followers.followers}
        loading={connections === "following" ? following.isLoading : followers.isLoading}
        emptyLabel={
          connections === "following"
            ? "You are not following anyone yet. Open a profile from any comment to follow them."
            : "Nobody yet."
        }
        onClose={() => setConnections(null)}
      />
      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />
      <EditTargetsDialog
        open={targetsOpen}
        onClose={() => setTargetsOpen(false)}
        holdings={book.holdings}
        initialTargets={saved.targets}
        onSave={saved.save}
      />
      <TopUpDialog
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        holdings={book.holdings}
        targets={targets}
      />
    </div>
  );
}

function TabButton({active, onClick, children}: {active: boolean; onClick: () => void; children: string}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-[38px] rounded-full px-[18px] text-[14px] font-extrabold transition-colors",
        active ? "bg-[var(--bg-input)] text-ink" : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Every holding, ETH included: what it is on the left, value and Total P&L on the right. */
function PhoneHoldings({rows}: {rows: readonly PortfolioRow[]}) {
  return (
    <ul className="mt-2 border-t border-[var(--overlay-wash)]" aria-label="Holdings">
      {rows.map((row) => (
        <li key={row.key} className="border-b border-[var(--overlay-wash)] last:border-b-0">
          <RowLink row={row} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3">
            <RowAvatar row={row} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">{row.symbol}</span>
                {row.kind === "rwa" ? <VerifiedTick size={13} /> : null}
                <Tag row={row} />
              </div>
              <div className="tabular-nums mt-[3px] truncate text-[12.5px] font-medium text-faint">
                <span className="whitespace-nowrap">{compactAmount(row.amount)}</span> {row.symbol}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular-nums whitespace-nowrap text-[15px] font-extrabold tracking-[-0.015em]">
                {row.priceState === "pending" ? (
                  <Skel className="h-[15px] w-[68px]" />
                ) : row.priceState === "none" ? (
                  <span className="text-faint">No price</span>
                ) : (
                  <>
                    {money(row.valueUsd)}
                    {row.priceState === "stale" ? <StaleMark at={row.priceAt} /> : null}
                  </>
                )}
              </div>
              <div className="tabular-nums mt-[3px] whitespace-nowrap text-[12.5px] font-semibold">
                {row.priceState === "pending" ? <Skel className="h-[12px] w-[96px]" /> : <Pnl row={row} joiner=" · " />}
              </div>
            </div>
          </RowLink>
        </li>
      ))}
    </ul>
  );
}

/** Degrees of empty space between slices. */
const SLICE_GAP = 1.6;

/**
 * The donut, then one list: each holding's share now and, once targets are
 * set, its target beside it — then Rebalance.
 */
function PhoneAllocation({
  rows,
  loading,
  targets,
  onRebalance,
}: {
  rows: readonly PortfolioRow[];
  loading: boolean;
  /** Saved targets that add up to 100%, or null when none are set. */
  targets: Record<string, number> | null;
  onRebalance: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const slices = useMemo(() => donutSlices(rows), [rows]);
  const arcs = useMemo(() => {
    let cursor = 0;
    const gap = slices.length > 1 ? SLICE_GAP : 0;
    return slices.map((slice) => {
      const sweep = (slice.share / 100) * 360;
      const start = cursor + gap / 2;
      const end = Math.max(start + 0.4, cursor + sweep - gap / 2);
      cursor += sweep;
      return {slice, path: donutArc(100, 100, 94, 66, start, end)};
    });
  }, [slices]);

  if (loading) {
    return <div className="mx-auto my-8 h-[190px] w-[190px] animate-pulse rounded-full border-[30px] border-[var(--overlay-wash)]" />;
  }
  if (slices.length === 0) {
    return (
      <p className="mx-auto my-10 max-w-[30ch] text-center text-[12.5px] leading-[1.5] text-faint">
        Your allocation shows here once you hold something with a live price.
      </p>
    );
  }

  const focus: DonutSlice = slices.find((slice) => slice.key === active) ?? slices[0];
  const targetOf = (slice: DonutSlice) => (targets ? targets[slice.key] : undefined);

  return (
    <div>
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Allocation: ${slices.map((slice) => `${slice.label} ${slice.share.toFixed(1)}%`).join(", ")}`}
        className="mx-auto mt-6 block h-[190px] w-[190px]"
      >
        {arcs.map(({slice, path}) => (
          <path
            key={slice.key}
            d={path}
            fill={slice.color}
            opacity={active == null || active === slice.key ? 1 : 0.35}
            className="cursor-pointer transition-opacity duration-150"
            onClick={() => setActive((prev) => (prev === slice.key ? null : slice.key))}
          >
            <title>
              {slice.label} · {slice.share.toFixed(1)}%
            </title>
          </path>
        ))}
        <text x={100} y={98} textAnchor="middle" className="fill-ink font-extrabold" style={{fontSize: 16}}>
          {focus.label}
        </text>
        <text x={100} y={118} textAnchor="middle" className="fill-muted font-semibold" style={{fontSize: 12}}>
          {focus.share.toFixed(1)}%
        </text>
      </svg>

      {targets ? (
        <div className="mt-6 text-right text-[12px] font-medium text-faint">Now / Target</div>
      ) : null}
      <ul className={cn("space-y-0.5", targets ? "mt-1" : "mt-6")} aria-label="Allocation by holding">
        {slices.map((slice) => {
          const target = targetOf(slice);
          return (
            <li
              key={slice.key}
              onClick={() => setActive((prev) => (prev === slice.key ? null : slice.key))}
              className={cn(
                "-mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-[15px] transition-colors",
                active === slice.key && "bg-[var(--overlay-wash)]",
              )}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{background: slice.color}} />
              <span className="min-w-0 flex-1 truncate font-extrabold text-ink">
                {slice.label}
                {slice.count ? <span className="font-semibold text-faint"> · {slice.count}</span> : null}
              </span>
              <span className="tabular-nums shrink-0 whitespace-nowrap font-extrabold text-ink">
                {slice.share.toFixed(1)}%
                {targets ? (
                  <span className="text-muted">
                    {" / "}
                    {target != null ? `${target.toFixed(1)}%` : "—"}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums min-w-[72px] shrink-0 whitespace-nowrap text-right font-medium text-faint">
                {money(slice.valueUsd)}
              </span>
            </li>
          );
        })}
      </ul>

      {targets ? (
        <button
          type="button"
          onClick={onRebalance}
          className="mt-6 min-h-[48px] rounded-full bg-brand-500 px-7 text-[16px] font-extrabold text-white shadow-brand transition-colors hover:bg-brand-600"
        >
          Rebalance
        </button>
      ) : null}
    </div>
  );
}
