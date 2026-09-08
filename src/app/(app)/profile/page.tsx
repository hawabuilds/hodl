"use client";

import {useState} from "react";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HoldingsList, HoldingsSkeleton} from "@/components/HoldingsList";
import {PillRail} from "@/components/PillRail";
import {PriceChart} from "@/components/PriceChart";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {SettingsMenu} from "@/components/SettingsMenu";
import {ShareProfileButton} from "@/components/ShareProfileButton";
import {SocialRow} from "@/components/SocialRow";
import {Avatar} from "@/components/ui/Avatar";
import {PencilIcon} from "@/components/ui/Icons";
import {usePortfolio} from "@/hooks/usePortfolio";
import {useMe} from "@/hooks/useMe";
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

export default function ProfilePage() {
  const me = useMe();
  const [range, setRange] = useState<PortfolioRange>("1D");
  const book = usePortfolio(range);
  const [side, setSide] = useState<Side>("token");
  const [editOpen, setEditOpen] = useState(false);
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [connections, setConnections] = useState<"followers" | "following" | null>(
    null,
  );

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
              {me.wallet ? (
                <span className="ml-1 font-mono text-[11.5px] font-medium">
                  {shortAddress(me.wallet, 4)}
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
        <button
          type="button"
          onClick={() => setConnections("followers")}
          className="transition-colors hover:text-green-deep"
        >
          <b className="tnum font-extrabold">
            {compact(followers.followers.length)}
          </b>{" "}
          <span className="text-faint">followers</span>
        </button>
        <button
          type="button"
          onClick={() => setConnections("following")}
          className="transition-colors hover:text-green-deep"
        >
          <b className="tnum font-extrabold">{follows.following.length}</b>{" "}
          <span className="text-faint">following</span>
        </button>
      </div>

      <div className="mb-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1.5 rounded-pill border border-hairline bg-card px-3.5 py-2 text-[12.5px] font-bold text-ink transition-colors hover:border-[var(--border-hover-strong)]"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit profile
        </button>
        <SocialRow socials={me.socials} />
      </div>

      <div className="text-[11px] font-bold tracking-[0.09em] text-faint">
        PORTFOLIO VALUE
      </div>
      <div className="tnum mt-1.5 text-[38px] font-extrabold leading-none tracking-[-0.035em]">
        {book.nativeReady || book.tokensReady
          ? book.holdings.length > 0 && shownValue <= 0
            ? "—"
            : money(shownValue)
          : "—"}
      </div>
      <div
        className={cn(
          "tnum mt-2 text-[13.5px] font-bold",
          shownChangeUsd >= 0 ? "text-green-deep" : "text-red",
        )}
      >
        {shownChangeUsd >= 0 ? "+" : "−"}
        {money(Math.abs(shownChangeUsd))}
        <span className="ml-1.5">{percent(shownChangePct)}</span>
        <span className="ml-1.5 font-semibold text-faint">{range}</span>
      </div>

      {book.connected ? (
        <>
          <PriceChart
            points={points}
            height={140}
            positive={positive}
            showBaseline={false}
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
      ) : null}

      <div className="mb-1 mt-6 text-[12.5px] font-semibold text-muted">
        <span className="tnum font-extrabold text-ink">
          {book.holdings.length > 0 && book.positionsValue <= 0
            ? "—"
            : money(book.positionsValue)}
        </span>{" "}
        in positions ·{" "}
        <span className="tnum font-extrabold text-ink">
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

      {book.error ? (
        <p className="mt-5 px-0.5 text-[13px] leading-[1.5] text-red">
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
      ) : null}

      <ConnectionsSheet
        open={connections === "followers"}
        title="Followers"
        people={followers.followers}
        loading={followers.isLoading}
        emptyLabel="Nobody yet."
        onClose={() => setConnections(null)}
      />
      <ConnectionsSheet
        open={connections === "following"}
        title="Following"
        people={following.people}
        loading={following.isLoading}
        emptyLabel="You are not following anyone yet. Open a profile from any comment to follow them."
        onClose={() => setConnections(null)}
      />

      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}
