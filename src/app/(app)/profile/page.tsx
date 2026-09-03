"use client";

import {useMemo, useState} from "react";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HoldingsList} from "@/components/HoldingsList";
import {PillRail} from "@/components/PillRail";
import {PriceChart} from "@/components/PriceChart";
import {SettingsMenu} from "@/components/SettingsMenu";
import {SocialRow} from "@/components/SocialRow";
import {Avatar} from "@/components/ui/Avatar";
import {SectionLabel} from "@/components/ui/Card";
import {PencilIcon} from "@/components/ui/Icons";
import {usePortfolio} from "@/hooks/usePortfolio";
import {useMe} from "@/hooks/useMe";
import {useMyFollowers, usePeople} from "@/hooks/usePeople";
import {useFollows} from "@/hooks/useProfile";
import {cn} from "@/lib/cn";
import {compact, money, percent, relativeTime, shortAddress, units} from "@/lib/format";
import {RANGES, type ChartPoint, type Range} from "@/lib/types";

type Side = "rwa" | "token";

const SIDES: FilterOption<Side>[] = [
  {value: "rwa", label: "RWAs"},
  {value: "token", label: "Tokens"},
];

/** How far back each range reaches, for spacing the points along the x axis. */
const RANGE_SPAN_MS: Record<Range, number> = {
  "1D": 86_400_000,
  "1W": 7 * 86_400_000,
  "1M": 30 * 86_400_000,
  "1Y": 365 * 86_400_000,
  ALL: 730 * 86_400_000,
};

export default function ProfilePage() {
  const me = useMe();
  const [range, setRange] = useState<Range>("1D");
  const book = usePortfolio(range);
  const [side, setSide] = useState<Side>("rwa");
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

  // Shaped like an asset chart so the two can share a component; the timestamps
  // only exist to space the points evenly across the window.
  const points: ChartPoint[] = useMemo(() => {
    const span = RANGE_SPAN_MS[range];
    const now = Date.now();
    const last = Math.max(book.series.length - 1, 1);
    return book.series.map((value, i) => ({
      t: now - span + (span * i) / last,
      price: value,
    }));
  }, [book.series, range]);

  const positive = book.changePct >= 0;
  const shownValue = scrubbed?.price ?? book.totalValue;
  const openValue = book.series[0] ?? book.totalValue;
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
    <div>
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
        <SettingsMenu />
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
        {book.isLoading ? "—" : money(shownValue)}
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

      {points.length > 1 ? (
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
            options={RANGES}
            value={range}
            onChange={setRange}
            positive={positive}
            className="mt-2"
          />
        </>
      ) : null}

      <div className="mb-1 mt-6 text-[12.5px] font-semibold text-muted">
        <span className="tnum font-extrabold text-ink">
          {money(book.positionsValue)}
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

      <HoldingsList
        holdings={shown}
        empty={
          side === "rwa"
            ? "No tokenized stocks yet. Buy one from any RWA chart page."
            : "No tokens yet. Buy one from any token chart page."
        }
      />

      {book.degraded ? (
        <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
          Balances could not be read just now, so this may be incomplete.
        </p>
      ) : !book.connected ? (
        <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
          Connect a wallet to see what you hold.
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
