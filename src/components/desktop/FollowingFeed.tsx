"use client";

import {useEffect, useMemo, useState, type ReactNode} from "react";
import Link from "next/link";

import {useActivity} from "@/hooks/useActivity";
import {useUser} from "@/hooks/useUser";
import {
  tradeUsdLabel,
  type ActivityAsset,
  type ActivityPerson,
  type FollowingItem,
} from "@/lib/alerts";
import {announceCommentTarget, commentHash} from "@/lib/alertBus";
import {cn} from "@/lib/cn";
import {relativeTime} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import {AssetLink} from "../AssetLink";
import {Avatar} from "../ui/Avatar";
import {ColumnNote, ColumnSegments} from "./BoardColumn";

/**
 * What the people you follow are doing: their HODL trades and their comments,
 * newest first, in the rail beside a token page.
 *
 * Trades are the ones recorded when a fill made through HODL confirmed on
 * chain from a wallet linked to that person's account — never a wallet anyone
 * typed in. The feed shows everything; Settings → Alerts only decides what
 * counts towards the tab's number and what pops up.
 */

const FILTERS = [
  {value: "all", label: "All"},
  {value: "trade", label: "Trades"},
  {value: "comment", label: "Comments"},
] as const;

type Filter = (typeof FILTERS)[number]["value"];

export function FollowingFeed() {
  const user = useUser();
  const {activity, isLoading, error, retry, markSeen} = useActivity();
  const [filter, setFilter] = useState<Filter>("all");
  // "2m ago" has to move on even when nothing new arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Open means read: the count clears, and stays clear while new rows land.
  const newest = activity?.following[0]?.at ?? null;
  useEffect(() => {
    if (newest) markSeen("following", newest);
  }, [newest, markSeen]);

  const items = useMemo(
    () =>
      (activity?.following ?? []).filter((item) => filter === "all" || item.type === filter),
    [activity, filter],
  );

  if (!user.authenticated) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-[12.5px] font-medium leading-[1.5] text-faint">
          Sign in to see what people you follow are doing
        </p>
        <button
          type="button"
          onClick={() => user.login()}
          className="mt-3.5 inline-flex h-[34px] items-center rounded-full bg-brand-500 px-4 text-[12.5px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (isLoading) return <ColumnNote>Loading what people you follow are doing…</ColumnNote>;
  if (error && !activity) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[12.5px] font-medium text-faint">Couldn&apos;t load the Following feed.</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 text-[12.5px] font-bold text-accent-link transition-colors hover:text-ink"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!activity || activity.followingCount === 0) {
    return (
      <ColumnNote>
        Follow people from their comments or profile to see their trades and comments here.
      </ColumnNote>
    );
  }

  return (
    <div>
      <div className="flex items-center px-3.5 pb-1 pt-2.5">
        <ColumnSegments label="Show" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      {items.length === 0 ? (
        <ColumnNote>Nothing yet from people you follow.</ColumnNote>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.type}:${item.id}`} className="border-b border-[var(--overlay-wash)] last:border-b-0">
              {item.type === "trade" ? <TradeRow item={item} /> : <CommentRow item={item} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const rowClass =
  "flex items-start gap-2.5 px-3.5 py-2.5 transition-colors duration-150 hover:bg-[var(--overlay-wash)]";

function TradeRow({item}: {item: Extract<FollowingItem, {type: "trade"}>}) {
  const buy = item.side === "buy";
  const size = tradeUsdLabel(item.usd);
  return (
    <AssetLink kind={item.asset.kind} id={item.asset.id} className={rowClass}>
      <PersonAvatar person={item.person} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-[1.35]">
          <span className="truncate font-extrabold">@{item.person.handle}</span>
          <span className={cn("shrink-0 font-bold", buy ? "text-price-up" : "text-price-down")}>
            {buy ? "bought" : "sold"}
          </span>
          {size ? <span className="shrink-0 font-extrabold tabular-nums">{size}</span> : null}
          <Ago at={item.at} />
        </span>
        <AssetChip asset={item.asset} className="mt-1" />
      </span>
    </AssetLink>
  );
}

function CommentRow({item}: {item: Extract<FollowingItem, {type: "comment"}>}) {
  const hash = commentHash(item.id);
  return (
    <AssetLink
      kind={item.asset.kind}
      id={item.asset.id}
      hash={hash}
      onClick={() => announceCommentTarget(hash)}
      className={rowClass}
    >
      <PersonAvatar person={item.person} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-[1.35]">
          <span className="truncate font-extrabold">@{item.person.handle}</span>
          <Ago at={item.at} />
        </span>
        <span className="mt-0.5 line-clamp-2 break-words text-[12.5px] leading-[1.4] text-muted">
          {item.body}
        </span>
        <AssetChip asset={item.asset} className="mt-1.5" />
      </span>
    </AssetLink>
  );
}

export function PersonAvatar({person, size = 30}: {person: ActivityPerson; size?: number}) {
  return <Avatar name={person.displayName} src={person.pfpUrl} seed={person.id} size={size} className="shrink-0" />;
}

function Ago({at}: {at: string}) {
  return (
    <time dateTime={at} className="ml-auto shrink-0 pl-1.5 text-[11px] font-medium text-faint">
      {relativeTime(at)}
    </time>
  );
}

/** Token logo, symbol and what it is paired against: "AI · NVDA". */
export function AssetChip({asset, className}: {asset: ActivityAsset; className?: string}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-[7px] bg-[var(--overlay-wash)] py-[3px] pl-[3px] pr-2 text-[11.5px] font-extrabold leading-none",
        className,
      )}
    >
      <AssetLogo asset={asset} size={16} />
      <span className="truncate">{asset.symbol}</span>
      {asset.pairedTicker ? (
        <span className="shrink-0 font-bold text-faint">· {asset.pairedTicker}</span>
      ) : null}
    </span>
  );
}

export function AssetLogo({asset, size}: {asset: ActivityAsset; size: number}) {
  if (asset.kind === "rwa" && !asset.imageUrl) {
    return (
      <span
        aria-hidden="true"
        style={{width: size, height: size, fontSize: Math.max(8, size * 0.42)}}
        className="grid shrink-0 place-items-center rounded-full bg-[var(--overlay-wash-hover)] font-extrabold text-muted"
      >
        {asset.symbol.slice(0, 2)}
      </span>
    );
  }
  return (
    <Avatar
      name={asset.symbol}
      src={asset.imageUrl}
      seed={asset.kind === "token" ? asset.id : undefined}
      size={size}
      className="shrink-0"
    />
  );
}

/** The follower's profile, for the bell. */
export function ProfileLink({
  handle,
  className,
  children,
  onClick,
}: {
  handle: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link href={profilePath(handle)} prefetch className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
