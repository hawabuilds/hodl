"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {PillRail} from "@/components/PillRail";
import {PriceChart} from "@/components/PriceChart";
import {ShareProfileButton} from "@/components/ShareProfileButton";
import {SocialRow} from "@/components/SocialRow";
import {AllocationCard, CARD, HoldingsCard, Skel, StatsCard} from "@/components/portfolio/PortfolioCards";
import {PhonePortfolio} from "@/components/portfolio/PhonePortfolio";
import {Avatar} from "@/components/ui/Avatar";
import {useIsDesktop} from "@/hooks/useBreakpoint";
import {usePortfolio} from "@/hooks/usePortfolio";
import {useMe} from "@/hooks/useMe";
import {useUser} from "@/hooks/useUser";
import {useWallet} from "@/hooks/useWallet";
import {useMyFollowers, usePeople} from "@/hooks/usePeople";
import {useFollows} from "@/hooks/useProfile";
import {cn} from "@/lib/cn";
import {compact, money, shortAddress} from "@/lib/format";
import {buildRows, totalPnl} from "@/lib/portfolioView";
import {PORTFOLIO_RANGES, type ChartPoint, type PortfolioRange} from "@/lib/types";

/** What the change under the total covers, for each chart range. */
const RANGE_NOTE: Record<PortfolioRange, string> = {
  "1H": "past hour",
  "1D": "today",
  "1W": "past week",
  "1M": "past month",
  "1Y": "past year",
  ALL: "all time",
};

/**
 * Portfolio. A desktop gets the card layout below; below the desktop
 * breakpoint the phone keeps its own layout (PhonePortfolio).
 */
export default function ProfilePage() {
  const desktop = useIsDesktop();
  return desktop ? <DesktopPortfolio /> : <PhonePortfolio />;
}

/**
 * The profile across the top; the value chart beside the stats; the holdings
 * beside the allocation.
 */
function DesktopPortfolio() {
  const me = useMe();
  const {embeddedWallet} = useUser();
  const imported = useWallet();
  const activeWallet =
    (imported.isConnected ? imported.address : null) ?? embeddedWallet ?? me.wallet;
  const [range, setRange] = useState<PortfolioRange>("1D");
  const book = usePortfolio(range);
  const allocationRef = useRef<HTMLDivElement>(null);
  // `?view=allocation` (the Home banner's "Rebalance" slide) opens on allocation.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") !== "allocation") return;
    allocationRef.current?.scrollIntoView({block: "start"});
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
    () => buildRows(book.holdings, book.ethBalance, book.ethValueUsd, book.ethPending, book.usdgBalance),
    [book.holdings, book.ethBalance, book.ethValueUsd, book.ethPending, book.usdgBalance],
  );
  const pnl = useMemo(() => totalPnl(rows, book.pnl), [rows, book.pnl]);

  const sep = <span aria-hidden="true" className="text-faint">·</span>;
  const profileRow = (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar name={me.displayName} src={me.pfpUrl} size={48} ring />
        <div className="min-w-0">
          <div className="truncate text-[20px] font-extrabold tracking-[-0.03em]">{me.displayName}</div>
          {/* One line on a desktop; a phone puts who you follow on its own line. */}
          <div className="mt-0.5 flex flex-col gap-0.5 text-[13px] font-medium text-faint lg:flex-row lg:items-center lg:gap-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{me.handle ? `@${me.handle}` : "Signed in"}</span>
              {activeWallet ? (
                <>
                  {sep}
                  <span className="shrink-0 font-mono text-[12px]">{shortAddress(activeWallet, 4)}</span>
                </>
              ) : null}
            </span>
            <span className="hidden lg:inline">{sep}</span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <button
                ref={followersRef}
                type="button"
                onClick={() => setConnections((prev) => (prev === "followers" ? null : "followers"))}
                className="transition-colors hover:text-accent-link"
              >
                <b className="tabular-nums font-extrabold text-ink">{compact(followers.followers.length)}</b> followers
              </button>
              {sep}
              <button
                ref={followingRef}
                type="button"
                onClick={() => setConnections((prev) => (prev === "following" ? null : "following"))}
                className="transition-colors hover:text-accent-link"
              >
                <b className="tabular-nums font-extrabold text-ink">{follows.following.length}</b> following
              </button>
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <SocialRow socials={me.socials} />
        {me.handle ? <ShareProfileButton handle={me.handle} title={me.displayName} /> : null}
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="ml-1 rounded-full border border-[var(--overlay-wash)] bg-surface-base px-4 py-2 text-[13px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash)]"
        >
          Edit profile
        </button>
      </div>
    </div>
  );

  const valueCard = (
    <section aria-label="Portfolio value" className={cn(CARD, "flex min-w-0 flex-col px-6 pb-3 pt-4 lg:px-7 [@media(max-height:760px)]:!pb-2 [@media(max-height:760px)]:!pt-3")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-faint">Portfolio value</div>
          {/* While any price is loading the total and its change would be
              wrong, so they hold a placeholder instead. */}
          <div className="tabular-nums mt-1.5 text-[40px] font-extrabold leading-none tracking-[-0.035em] lg:text-[44px] [@media(max-height:760px)]:!mt-1 [@media(max-height:760px)]:!text-[36px]">
            {book.pricesPending ? (
              <Skel className="h-[40px] w-[220px] lg:h-[46px]" />
            ) : ready ? (
              book.holdings.length > 0 && shownValue <= 0 ? "—" : money(shownValue)
            ) : (
              "—"
            )}
          </div>
          <div
            className={cn(
              "tabular-nums mt-2 text-[14px] font-bold [@media(max-height:760px)]:!mt-1",
              shownChangeUsd >= 0 ? "text-price-up" : "text-price-down",
            )}
          >
            {book.pricesPending ? (
              <Skel className="h-[14px] w-[190px]" />
            ) : ready ? (
              <>
                <span aria-hidden="true" className="mr-1 text-[0.85em]">
                  {shownChangeUsd >= 0 ? "▲" : "▼"}
                </span>
                {money(Math.abs(shownChangeUsd))} ({Math.abs(shownChangePct).toFixed(1)}%)
                <span className="ml-1.5 font-semibold text-muted">{scrubbed ? "since start" : RANGE_NOTE[range]}</span>
              </>
            ) : (
              " "
            )}
          </div>
        </div>
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
        // Fills whatever height the row gives it, so it lines up with the stats.
        <div className="relative mt-2 min-h-[120px] flex-1 [@media(max-height:760px)]:!mt-1 [@media(max-height:760px)]:!min-h-[84px]">
          <div className="absolute inset-0">
            {/* Its own time labels: the first and last always, inside the card. */}
            <PriceChart
              points={points}
              height="100%"
              positive={positive}
              onScrub={setScrubbed}
              rightPadPx={12}
              edgeTimeLabels
              verticalPad={0.08}
              fitKey={`${range}:${points[0]?.t ?? ""}`}
            />
          </div>
        </div>
      ) : null}
    </section>
  );

  const statsCard = (
    <StatsCard
      investedUsd={book.positionsValue}
      ethUsd={book.ethValueUsd}
      pnl={pnl}
      ready={book.tokensReady}
      pending={book.pricesPending}
      ethPending={book.ethPending}
    />
  );

  const statusNote = book.error ? (
    <p className="text-[13px] leading-[1.5] text-error">
      Couldn&apos;t load your balances. Pull to refresh and try again.
    </p>
  ) : book.degraded ? (
    <p className="text-[12px] leading-[1.5] text-faint">
      Balances could not be read just now, so this may be incomplete.
    </p>
  ) : !book.connected ? (
    <p className="text-[12px] leading-[1.5] text-faint">Connect a wallet to see what you hold.</p>
  ) : book.staleCount > 0 ? (
    <p className="text-[12px] leading-[1.5] text-faint">
      {book.staleCount === 1 ? "One price" : `${book.staleCount} prices`} could not be refreshed, so the last
      known {book.staleCount === 1 ? "one is" : "ones are"} shown (marked stale). Retrying.
    </p>
  ) : null;

  const holdingsCard = (
    <HoldingsCard
      rows={rows}
      loading={book.isLoading}
      allowTable
      status={statusNote}
      pricesPending={book.pricesPending}
    />
  );
  const allocationCard = (
    <div ref={allocationRef} className="flex min-w-0 scroll-mt-4 flex-col [&>section]:flex-1">
      <AllocationCard rows={rows} holdings={book.holdings} loading={book.isLoading} pending={book.pricesPending} />
    </div>
  );

  const overlays = (
    <>
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
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 pb-12 pt-5 xl:px-10 xl:pt-6 [@media(max-height:760px)]:!pt-3">
      {profileRow}
      {me.bio ? <p className="mt-3 max-w-[70ch] text-[13.5px] leading-[1.5] text-muted">{me.bio}</p> : null}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_340px] gap-5 xl:grid-cols-[minmax(0,1fr)_400px] [@media(max-height:760px)]:!mt-3 [@media(max-height:760px)]:!gap-4">
        {valueCard}
        {statsCard}
        {holdingsCard}
        {allocationCard}
      </div>
      {overlays}
    </div>
  );
}
