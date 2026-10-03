"use client";

import {use, useMemo, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HoldingsList} from "@/components/HoldingsList";
import {ShareProfileButton} from "@/components/ShareProfileButton";
import {SocialRow} from "@/components/SocialRow";
import {Avatar} from "@/components/ui/Avatar";
import {ChevronLeftIcon} from "@/components/ui/Icons";
import {usePeople} from "@/hooks/usePeople";
import {useFollows, useProfile} from "@/hooks/useProfile";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {cn} from "@/lib/cn";
import {compact, money, percent, shortAddress} from "@/lib/format";

type Side = "rwa" | "token";
type Connections = "followers" | "following";

export default function PublicProfilePage(props: {params: Promise<{handle: string}>}) {
  const params = use(props.params);
  const router = useRouter();
  const {profile, followerHandles, followingHandles, holdingsVisible, isLoading, notFound} =
    useProfile(params.handle);
  const follows = useFollows();
  const [side, setSide] = useState<Side>("token");
  const [connections, setConnections] = useState<Connections | null>(null);
  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);
  const connectionsAnchor =
    connections === "following" ? followingRef : followersRef;

  const shownHandles =
    connections === "following" ? followingHandles : followerHandles;
  const connectionProfiles = usePeople(shownHandles, connections !== null);

  const following = profile ? follows.has(profile.handle) : false;
  const holdings = useMemo(() => profile?.holdings ?? [], [profile]);

  // Someone else's book shows what it is worth, and nothing about what they
  // paid: there is no cost basis for a balance this platform did not fill, and
  // no value line either, because the entry times behind one are not published.
  const totals = useMemo(
    () => ({value: holdings.reduce((sum, h) => sum + h.valueUsd, 0)}),
    [holdings],
  );

  const sides: FilterOption<Side>[] = [
    {
      value: "token",
      label: "Tokens",
      hint: String(holdings.filter((h) => h.kind === "token").length),
    },
    {
      value: "rwa",
      label: "RWAs",
      hint: String(holdings.filter((h) => h.kind === "rwa").length),
    },
  ];

  const followerCount = profile?.followers ?? 0;

  if (isLoading) return <ProfileSkeleton />;

  if (notFound || !profile) {
    return (
      <div className={APP_SCROLL_PAD_TOP}>
        <BackButton onClick={() => router.back()} />
        <p className="mt-5 text-[14px] text-muted">
          No profile for @{params.handle}.
        </p>
      </div>
    );
  }

  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <BackButton onClick={() => router.back()} />

      <div className="mt-3 flex items-start gap-3">
        <Avatar name={profile.displayName} src={profile.pfpUrl} size={56} ring />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-extrabold tracking-[-0.03em]">
            {profile.displayName}
          </div>
          <div className="truncate text-[12.5px] font-semibold text-faint">
            @{profile.handle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ShareProfileButton
            handle={profile.handle}
            title={profile.displayName}
          />
          <button
            type="button"
            onClick={() => follows.toggle(profile.handle)}
            aria-pressed={following}
            className={cn(
              "shrink-0 rounded-pill px-4 py-2.5 text-[12.5px] font-bold transition-colors",
              following
                ? "bg-[var(--overlay-wash)] text-muted hover:bg-[var(--overlay-wash-hover)]"
                : "bg-btn-dark text-btn-dark-fg shadow-brand",
            )}
          >
            {following ? "Following" : "Follow"}
          </button>
        </div>
      </div>

      <p className="mt-3 text-[13.5px] leading-[1.5] text-muted">{profile.bio}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-semibold">
        <button
          ref={followersRef}
          type="button"
          onClick={() =>
            setConnections((prev) => (prev === "followers" ? null : "followers"))
          }
          className="transition-colors hover:text-accent-link"
        >
          <b className="tabular-nums font-extrabold">{compact(followerCount)}</b>{" "}
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
          <b className="tabular-nums font-extrabold">{compact(profile.following)}</b>{" "}
          <span className="text-faint">following</span>
        </button>
      </div>

      <SocialRow socials={profile.socials} className="-ml-2 mt-1.5" />

      {holdingsVisible ? (
        <>
          <div className="mt-5 text-[11px] font-bold tracking-[0.09em] text-faint">
            TOTAL HOLDINGS
          </div>
          <div className="tabular-nums mt-1.5 text-[32px] font-extrabold leading-none tracking-[-0.035em]">
            {money(totals.value)}
          </div>
          <div className="tabular-nums mt-2 text-[13.5px] font-semibold text-faint">
            Held on Robinhood Chain
          </div>

          <FilterRail
            label="Filter holdings"
            options={sides}
            value={side}
            onChange={setSide}
            className="mb-1 mt-4"
          />

          <HoldingsList
            holdings={holdings.filter((h) => h.kind === side)}
            empty={
              side === "rwa"
                ? `@${profile.handle} holds no tokenized stocks.`
                : `@${profile.handle} holds no RWA-paired tokens.`
            }
          />
        </>
      ) : (
        <p className="mt-5 text-[13px] leading-[1.5] text-muted">
          @{profile.handle} keeps their portfolio private.
        </p>
      )}

      <ConnectionsSheet
        open={connections !== null}
        anchorRef={connectionsAnchor}
        title={connections === "following" ? "Following" : "Followers"}
        people={connectionProfiles.people}
        loading={connectionProfiles.isLoading}
        emptyLabel="Nobody yet."
        onClose={() => setConnections(null)}
      />

    </div>
  );
}

function BackButton({onClick}: {onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="-ml-1.5 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
    >
      <ChevronLeftIcon className="h-5 w-5" />
    </button>
  );
}

function ProfileSkeleton() {
  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <div className="h-9 w-9 animate-pulse rounded-full bg-wash" />
      <div className="mt-3 flex items-center gap-3">
        <div className="h-14 w-14 animate-pulse rounded-full bg-wash" />
        <div className="flex-1">
          <div className="h-4 w-32 animate-pulse rounded bg-wash" />
          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-wash" />
        </div>
      </div>
      <div className="mt-6 h-20 animate-pulse rounded-panel bg-wash" />
      <div className="mt-4 h-40 animate-pulse rounded-[16px] bg-wash" />
    </div>
  );
}
