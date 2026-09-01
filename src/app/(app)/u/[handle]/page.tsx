"use client";

import {useMemo, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {HoldingsList} from "@/components/HoldingsList";
import {SocialRow} from "@/components/SocialRow";
import {Avatar} from "@/components/ui/Avatar";
import {ChevronLeftIcon} from "@/components/ui/Icons";
import {Sheet, SheetTitle} from "@/components/ui/Sheet";
import {useFollows, useProfile} from "@/hooks/useProfile";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {cn} from "@/lib/cn";
import {compact, money, shortAddress} from "@/lib/format";
import {profilePath} from "@/lib/routes";

type Side = "rwa" | "token";
type Connections = "followers" | "following";

export default function PublicProfilePage({
  params,
}: {
  params: {handle: string};
}) {
  const router = useRouter();
  const {profile, followerHandles, followingHandles, isLoading, notFound} =
    useProfile(params.handle);
  const follows = useFollows();
  const [side, setSide] = useState<Side>("rwa");
  const [connections, setConnections] = useState<Connections | null>(null);

  const following = profile ? follows.has(profile.handle) : false;

  const holdings = useMemo(
    () => (profile?.holdings ?? []).filter((h) => h.kind === side),
    [profile, side],
  );

  const totalValue = (profile?.holdings ?? []).reduce(
    (sum, h) => sum + h.valueUsd,
    0,
  );

  // A local follow is only visible to this browser, so it is added to the
  // seeded count rather than replacing it.
  const followerCount = (profile?.followers ?? 0) + (following ? 1 : 0);

  if (isLoading) return <ProfileSkeleton />;

  if (notFound || !profile) {
    return (
      <div className="pt-2">
        <BackButton onClick={() => router.back()} />
        <p className="mt-5 text-[14px] text-muted">
          No profile for @{params.handle}.
        </p>
      </div>
    );
  }

  return (
    <div>
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
        <button
          type="button"
          onClick={() => follows.toggle(profile.handle)}
          aria-pressed={following}
          className={cn(
            "shrink-0 rounded-pill px-4 py-2.5 text-[12.5px] font-bold transition-colors",
            following
              ? "border border-hairline bg-card text-muted hover:border-[var(--border-hover-strong)]"
              : "bg-btn-dark text-btn-dark-fg",
          )}
        >
          {following ? "Following" : "Follow"}
        </button>
      </div>

      <p className="mt-3 text-[13.5px] leading-[1.5] text-muted">{profile.bio}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-semibold">
        <button
          type="button"
          onClick={() => setConnections("followers")}
          className="transition-colors hover:text-green-deep"
        >
          <b className="tnum font-extrabold">{compact(followerCount)}</b>{" "}
          <span className="text-faint">followers</span>
        </button>
        <button
          type="button"
          onClick={() => setConnections("following")}
          className="transition-colors hover:text-green-deep"
        >
          <b className="tnum font-extrabold">{compact(profile.following)}</b>{" "}
          <span className="text-faint">following</span>
        </button>
        <a
          href={addressUrlForChain(profile.wallet, RH_MAINNET_ID)}
          target="_blank"
          rel="noopener noreferrer"
          className="tnum text-faint transition-colors hover:text-ink"
        >
          {shortAddress(profile.wallet, 4)}
        </a>
      </div>

      <SocialRow socials={profile.socials} className="-ml-2 mt-1.5" />

      <div className="mb-4 mt-5 rounded-panel border border-hairline bg-gradient-to-b from-card to-[var(--surface-elevated)] px-[22px] py-4 shadow-panel">
        <div className="text-[11px] font-bold tracking-[0.09em] text-faint">
          PUBLIC HOLDINGS
        </div>
        <div className="tnum mt-1.5 text-[28px] font-extrabold tracking-[-0.035em]">
          {money(totalValue)}
        </div>
      </div>

      <div className="mb-3 flex gap-0.5 rounded-[12px] border border-hairline bg-wash p-[3px]">
        {(
          [
            {value: "rwa", label: "RWAs"},
            {value: "token", label: "Tokens"},
          ] as const
        ).map((option) => {
          const active = option.value === side;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setSide(option.value)}
              className={cn(
                "flex-1 rounded-[9px] py-2 text-[13px] font-extrabold transition-all duration-150",
                active
                  ? "bg-card text-ink shadow-[0_2px_6px_-3px_rgba(9,24,14,0.3)]"
                  : "text-faint",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <HoldingsList
        holdings={holdings}
        empty={
          side === "rwa"
            ? `@${profile.handle} holds no tokenized stocks.`
            : `@${profile.handle} holds no RWA-paired tokens.`
        }
      />

      <Sheet
        open={connections !== null}
        onClose={() => setConnections(null)}
        height="auto"
        label={connections ?? "Connections"}
        header={
          <SheetTitle
            title={connections === "following" ? "Following" : "Followers"}
            onClose={() => setConnections(null)}
          />
        }
      >
        <ConnectionList
          handles={
            connections === "following" ? followingHandles : followerHandles
          }
          onNavigate={() => setConnections(null)}
        />
      </Sheet>
    </div>
  );
}

function ConnectionList({
  handles,
  onNavigate,
}: {
  handles: string[];
  onNavigate: () => void;
}) {
  if (handles.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted">Nobody yet.</p>
    );
  }

  return (
    <ul className="pb-2 pt-1">
      {handles.map((handle) => (
        <li key={handle}>
          <Link
            href={profilePath(handle)}
            onClick={onNavigate}
            className="flex items-center gap-3 border-b border-hairline py-3 last:border-b-0"
          >
            <Avatar name={handle} size={34} />
            <span className="text-[13.5px] font-extrabold">@{handle}</span>
          </Link>
        </li>
      ))}
    </ul>
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
    <div className="pt-2">
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
