"use client";

import {useEffect, useRef, useState} from "react";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {AllocationPanel} from "@/components/allocation/AllocationPanel";
import {ColumnSegments} from "@/components/desktop/BoardColumn";
import {HoldingsList, HoldingsSkeleton, HoldingsTable} from "@/components/HoldingsList";
import {PillRail} from "@/components/PillRail";
import {PriceChart} from "@/components/PriceChart";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {SettingsMenu} from "@/components/SettingsMenu";
import {ShareProfileButton} from "@/components/ShareProfileButton";
import {SocialRow} from "@/components/SocialRow";
import {Avatar} from "@/components/ui/Avatar";
import {PencilIcon} from "@/components/ui/Icons";
import {useIsDesktop, useIsWideDesktop} from "@/hooks/useBreakpoint";
import {usePortfolio} from "@/hooks/usePortfolio";
import {useMe} from "@/hooks/useMe";
import {useUser} from "@/hooks/useUser";
import {useWallet} from "@/hooks/useWallet";
import {useMyFollowers, usePeople} from "@/hooks/usePeople";
import {useFollows} from "@/hooks/useProfile";
import {cn} from "@/lib/cn";
import {compact, money, percent, shortAddress} from "@/lib/format";
import {PORTFOLIO_RANGES, type ChartPoint, type PortfolioRange} from "@/lib/types";

type Side = "rwa" | "token";

const SIDES: FilterOption<Side>[] = [
  {value: "token", label: "Tokens"},
  {value: "rwa", label: "RWAs"},
];

type DeskSide = "all" | Side;

export default function ProfilePage() {
  const me = useMe();
  const {embeddedWallet} = useUser();
  const imported = useWallet();
  const activeWallet =
    (imported.isConnected ? imported.address : null) ?? embeddedWallet ?? me.wallet;
  const [range, setRange] = useState<PortfolioRange>("1D");
  const book = usePortfolio(range);
  const [side, setSide] = useState<Side>("token");
  const [deskSide, setDeskSide] = useState<DeskSide>("all");
  const [chartView, setChartView] = useState<"trend" | "allocation">("trend");
  const desktop = useIsDesktop();
  const wide = useIsWideDesktop();
  // Below 1400px Holdings and Allocation share one panel, switched by its title.
  const [lowerView, setLowerView] = useState<"holdings" | "allocation">("holdings");
  // `?view=allocation` (the Home banner's "Rebalance" slide) opens on allocation.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") !== "allocation") return;
    setChartView("allocation");
    setLowerView("allocation");
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [connections, setConnections] = useState<"followers" | "following" | null>(
    null,
  );
  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);
  const connectionsAnchor =
    connections === "following" ? followingRef : followersRef;

  const follows = useFollows();
  // Loaded up front rather than on open, so the count beside the label is the
  // length of the list the sheet actually shows.
  const followers = useMyFollowers();
  const following = usePeople(follows.following, connections === "following");

  const points: ChartPoint[] = book.points;

  const positive = book.changePct >= 0;
  const shownValue = scrubbed?.price ?? book.totalValue;
  const openValue = points[0]?.price ?? book.totalValue;
  const shownChangeUsd = scrubbed ? scrubbed.price - openValue : book.changeUsd;
  const shownChangePct =
    openValue > 0 ? (shownChangeUsd / openValue) * 100 : 0;

  const shown = side === "rwa" ? book.rwaHoldings : book.tokenHoldings;

  const sides: FilterOption<Side>[] = SIDES.map((option) => ({
    ...option,
    hint: String(
      option.value === "rwa"
        ? book.rwaHoldings.length
        : book.tokenHoldings.length,
    ),
  }));

  const connectionButtons = (
    <>
      <button
        ref={followersRef}
        type="button"
        onClick={() =>
          setConnections((prev) => (prev === "followers" ? null : "followers"))
        }
        className="transition-colors hover:text-accent-link"
      >
        <b className="tabular-nums font-extrabold">
          {compact(followers.followers.length)}
        </b>{" "}
        <span className="text-faint">followers</span>
      </button>
      <button
        ref={followingRef}
        type="button"
        onClick={() =>
          setConnections((prev) => (prev === "following" ? null : "following"))
        }
        className="transition-colors hover:text-accent-link"
      >
        <b className="tabular-nums font-extrabold">{follows.following.length}</b>{" "}
        <span className="text-faint">following</span>
      </button>
    </>
  );

  const editButton = (
    <button
      type="button"
      onClick={() => setEditOpen(true)}
      className="flex items-center gap-1.5 rounded-full bg-[var(--overlay-wash)] px-3.5 py-2 text-[12.5px] font-bold text-ink transition-[background-color,transform] hover:-translate-y-px hover:bg-[var(--overlay-wash-hover)]"
    >
      <PencilIcon className="h-3.5 w-3.5" />
      Edit profile
    </button>
  );

  const valueFigure = (
    <>
      <div className="text-[11px] font-bold tracking-[0.09em] text-faint">
        PORTFOLIO VALUE
      </div>
      <div className="tabular-nums mt-1.5 text-[38px] font-extrabold leading-none tracking-[-0.035em]">
        {book.nativeReady || book.tokensReady
          ? book.holdings.length > 0 && shownValue <= 0
            ? "—"
            : money(shownValue)
          : "—"}
      </div>
      <div
        className={cn(
          "tabular-nums mt-2 text-[13.5px] font-bold",
          shownChangeUsd >= 0 ? "text-price-up" : "text-price-down",
        )}
      >
        <span aria-hidden="true" className="mr-0.5">
          {shownChangeUsd >= 0 ? "▲" : "▼"}
        </span>
        {shownChangeUsd >= 0 ? "+" : "−"}
        {money(Math.abs(shownChangeUsd))}
        <span className="ml-1.5">{percent(shownChangePct)}</span>
        <span className="ml-1.5 font-semibold text-faint">{range}</span>
      </div>
    </>
  );

  const statusNote = book.error ? (
    <p className="mt-5 px-0.5 text-[13px] leading-[1.5] text-error">
      Couldn&apos;t load your balances. Pull to refresh and try again.
    </p>
  ) : book.degraded ? (
    <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
      Balances could not be read just now, so this may be incomplete.
    </p>
  ) : !book.connected ? (
    <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
      Connect a wallet to see what you hold.
    </p>
  ) : book.holdings.length === 0 && !book.isLoading ? (
    <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
      You hold nothing in the HODL universe on these wallets.
    </p>
  ) : null;

  const overlays = (
    <>
      <ConnectionsSheet
        open={connections !== null}
        anchorRef={connectionsAnchor}
        title={connections === "following" ? "Following" : "Followers"}
        people={connections === "following" ? following.people : followers.followers}
        loading={
          connections === "following" ? following.isLoading : followers.isLoading
        }
        emptyLabel={
          connections === "following"
            ? "You are not following anyone yet. Open a profile from any comment to follow them."
            : "Nobody yet."
        }
        onClose={() => setConnections(null)}
      />

      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );

  if (desktop) {
    const tokensValue = book.tokenHoldings.reduce((sum, h) => sum + h.valueUsd, 0);
    const rwasValue = book.rwaHoldings.reduce((sum, h) => sum + h.valueUsd, 0);
    const allocated = tokensValue + rwasValue + book.ethValueUsd;
    const rows = [
      ...(deskSide === "all"
        ? book.holdings
        : deskSide === "rwa"
          ? book.rwaHoldings
          : book.tokenHoldings),
    ].sort((a, b) => b.valueUsd - a.valueUsd);
    const deskSides = [
      {value: "all" as const, label: `All ${book.holdings.length}`},
      {value: "token" as const, label: `Tokens ${book.tokenHoldings.length}`},
      {value: "rwa" as const, label: `RWAs ${book.rwaHoldings.length}`},
    ];

    // Who you are down the left; what you hold across the rest. The phone
    // stacks these; a desktop has the width to show the profile, the value
    // and every position at once, with the positions as a table.
    return (
      <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-2.5 p-2.5">
        <aside className="scroll-quiet flex min-h-0 flex-col overflow-y-auto rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base px-5 py-[22px]">
          <Avatar name={me.displayName} src={me.pfpUrl} size={72} ring />
          <div className="mt-3.5 truncate text-[21px] font-extrabold tracking-[-0.03em]">
            {me.displayName}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] font-semibold text-faint">
            {me.handle ? `@${me.handle}` : "Signed in"}
            {activeWallet ? (
              <span className="ml-1 font-mono text-[11.5px] font-medium">
                {shortAddress(activeWallet, 4)}
              </span>
            ) : null}
          </div>
          {me.bio ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-muted">{me.bio}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-4 text-[12.5px] font-semibold">
            {connectionButtons}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {editButton}
            {me.handle ? (
              <ShareProfileButton handle={me.handle} title={me.displayName} />
            ) : null}
            <SocialRow socials={me.socials} />
          </div>

          <dl className="mt-[22px] grid grid-cols-2 gap-3.5 border-t border-[var(--overlay-wash)] pt-4">
            <Stat
              label="Positions"
              value={
                book.holdings.length > 0 && book.positionsValue <= 0
                  ? "—"
                  : money(book.positionsValue)
              }
            />
            <Stat label="ETH" value={money(book.ethValueUsd)} />
            <Stat label="Tokens" value={String(book.tokenHoldings.length)} />
            <Stat label="RWAs" value={String(book.rwaHoldings.length)} />
          </dl>

          {allocated > 0 ? (
            <div className="mt-[18px]">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
                Split
              </div>
              <div className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full">
                {tokensValue > 0 ? (
                  <span className="bg-brand-500" style={{flexGrow: tokensValue}} />
                ) : null}
                {rwasValue > 0 ? (
                  <span className="bg-success" style={{flexGrow: rwasValue}} />
                ) : null}
                {book.ethValueUsd > 0 ? (
                  <span className="bg-faint" style={{flexGrow: book.ethValueUsd}} />
                ) : null}
              </div>
              <div className="mt-2 flex gap-3 text-[11.5px] font-semibold text-muted">
                <Legend className="bg-brand-500" label="Tokens" />
                <Legend className="bg-success" label="RWAs" />
                <Legend className="bg-faint" label="ETH" />
              </div>
            </div>
          ) : null}
        </aside>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5">
          <section className="rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base px-[22px] pb-3 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>{valueFigure}</div>
              {book.connected ? (
                <PillRail
                  label="Portfolio range"
                  options={PORTFOLIO_RANGES}
                  value={range}
                  onChange={setRange}
                  positive={positive}
                  className="mt-0"
                />
              ) : null}
            </div>
            {book.connected ? (
              <PriceChart
                points={points}
                height="clamp(150px, 24vh, 240px)"
                positive={positive}
                onScrub={setScrubbed}
                className="mt-3"
              />
            ) : null}
          </section>

          <div className={cn("grid min-h-0 gap-2.5", wide && "grid-cols-[minmax(0,1fr)_380px]")}>
          <section className="flex min-h-0 flex-col rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base pt-3.5">
            <div className="flex items-center justify-between gap-3 px-[18px] pb-3">
              {wide ? (
                <h2 className="text-[15px] font-extrabold tracking-[-0.02em]">Holdings</h2>
              ) : (
                <ColumnSegments
                  label="Holdings or allocation"
                  options={[
                    {value: "holdings", label: "Holdings"},
                    {value: "allocation", label: "Allocation"},
                  ]}
                  value={lowerView}
                  onChange={setLowerView}
                  size="md"
                />
              )}
              {wide || lowerView === "holdings" ? (
                <ColumnSegments
                  label="Filter holdings"
                  options={deskSides}
                  value={deskSide}
                  onChange={setDeskSide}
                  size="md"
                />
              ) : null}
            </div>
            {!wide && lowerView === "allocation" ? (
              <AllocationPanel holdings={book.holdings} loading={book.isLoading} layout="desktop" title={false} />
            ) : (
            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
              {book.isLoading && rows.length === 0 ? (
                <div className="px-[22px]">
                  <HoldingsSkeleton />
                </div>
              ) : (
                <HoldingsTable
                  holdings={rows}
                  totalValue={book.totalValue}
                  empty={
                    deskSide === "rwa"
                      ? "No tokenized stocks yet. Buy one from any RWA chart page."
                      : deskSide === "token"
                        ? "No tokens yet. Buy one from any token chart page."
                        : "Nothing here yet. Buy from any chart page."
                  }
                />
              )}
              <div className="px-[18px] pb-4">{statusNote}</div>
            </div>
            )}
          </section>

          {wide ? (
            <section
              aria-label="Allocation"
              className="flex min-h-0 flex-col rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base pt-3.5"
            >
              <AllocationPanel holdings={book.holdings} loading={book.isLoading} layout="desktop" />
            </section>
          ) : null}
          </div>
        </div>

        {overlays}
      </div>
    );
  }

  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={me.displayName} src={me.pfpUrl} size={52} ring />
          <div className="min-w-0">
            <div className="truncate text-[19px] font-extrabold tracking-[-0.03em]">
              {me.displayName}
            </div>
            <div className="truncate text-[12.5px] font-semibold text-faint">
              {me.handle ? `@${me.handle}` : "Signed in"}
              {activeWallet ? (
                <span className="ml-1 font-mono text-[11.5px] font-medium">
                  {shortAddress(activeWallet, 4)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {me.handle ? (
            <ShareProfileButton handle={me.handle} title={me.displayName} />
          ) : null}
          <SettingsMenu />
        </div>
      </div>

      {me.bio ? (
        <p className="mb-2.5 text-[13.5px] leading-[1.5] text-muted">{me.bio}</p>
      ) : null}

      <div className="mb-4 flex items-center gap-4 text-[12.5px] font-semibold">
        {connectionButtons}
      </div>

      <div className="mb-5 flex items-center gap-2">
        {editButton}
        <SocialRow socials={me.socials} />
      </div>

      {valueFigure}

      {book.connected ? (
        <>
          <div className="mt-3">
            <ColumnSegments
              label="Portfolio view"
              options={[
                {value: "trend", label: "Trend"},
                {value: "allocation", label: "Allocation"},
              ]}
              value={chartView}
              onChange={setChartView}
              size="touch"
            />
          </div>
          {chartView === "allocation" ? (
            <div className="mt-3">
              <AllocationPanel holdings={book.holdings} loading={book.isLoading} layout="phone" />
            </div>
          ) : (
            <>
              <PriceChart
                points={points}
                height={140}
                positive={positive}
                onScrub={setScrubbed}
                className="mt-3"
              />
              <PillRail
                label="Portfolio range"
                options={PORTFOLIO_RANGES}
                value={range}
                onChange={setRange}
                positive={positive}
                className="mt-2"
              />
            </>
          )}
        </>
      ) : null}

      <div className="mb-1 mt-6 text-[12.5px] font-semibold text-muted">
        <span className="tabular-nums font-extrabold text-ink">
          {book.holdings.length > 0 && book.positionsValue <= 0
            ? "—"
            : money(book.positionsValue)}
        </span>{" "}
        in positions ·{" "}
        <span className="tabular-nums font-extrabold text-ink">
          {money(book.ethValueUsd)}
        </span>{" "}
        ETH
      </div>

      <FilterRail
        label="Filter holdings"
        options={sides}
        value={side}
        onChange={setSide}
        className="mb-1 mt-3"
      />

      {book.isLoading && shown.length === 0 ? (
        <HoldingsSkeleton />
      ) : (
        <HoldingsList
          holdings={shown}
          empty={
            side === "rwa"
              ? "No tokenized stocks yet. Buy one from any RWA chart page."
              : "No tokens yet. Buy one from any token chart page."
          }
        />
      )}

      {statusNote}

      {overlays}
    </div>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div>
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
        {label}
      </dt>
      <dd className="tabular-nums mt-1 text-[16px] font-extrabold tracking-[-0.02em]">
        {value}
      </dd>
    </div>
  );
}

function Legend({className, label}: {className: string; label: string}) {
  return (
    <span className="flex items-center gap-[5px]">
      <span className={cn("h-2 w-2 rounded-[2px]", className)} />
      {label}
    </span>
  );
}
