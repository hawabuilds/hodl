"use client";

import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {AssetLink} from "@/components/AssetLink";
import {StickyPageHeader} from "@/components/AppShell";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {Avatar} from "@/components/ui/Avatar";
import {VerifiedTick} from "@/components/ui/Badges";
import {ArrowUpRightIcon, NewsIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import {newsTime} from "@/lib/format";
import {NEWS_FEED_QUERY_KEY, selectTodayStories} from "@/lib/newsWindow";
import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";

const WINDOWS: FilterOption<NewsWindow>[] = [
  {value: "24h", label: "Today"},
  {value: "7d", label: "This week"},
  {value: "30d", label: "This month"},
  {value: "all", label: "All time"},
];

const TOPICS: FilterOption<NewsTopic>[] = [
  {value: "all", label: "Top stories"},
  {value: "rwa", label: "RWA stocks"},
  {value: "robinhood", label: "Robinhood"},
  {value: "posts", label: "Robinhood socials"},
];

interface FeedResponse {
  items: FeedItem[];
  seeded: boolean;
}

export default function NewsPage() {
  const [window, setWindow] = useState<NewsWindow>("24h");
  const [topic, setTopic] = useState<NewsTopic>("all");

  const feed = useQuery({
    queryKey: [NEWS_FEED_QUERY_KEY, window, topic],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/news?window=${window}&topic=${topic}`);
      if (!res.ok) throw new Error("Could not load the news feed.");
      return (await res.json()) as FeedResponse;
    },
  });

  const items = useMemo(() => {
    const raw = feed.data?.items ?? [];
    if (window !== "24h") return raw;
    return selectTodayStories(raw);
  }, [feed.data?.items, window]);
  const accounts = items.filter((item) => item.kind === "account");
  const articles = items.filter((item) => item.kind === "article");
  const [lead, ...rest] = articles;

  return (
    <div>
      <StickyPageHeader>
        <Masthead />

        <div className="mb-4 flex flex-col gap-2.5">
          <FilterRail
            label="Filter by topic"
            options={TOPICS}
            value={topic}
            onChange={setTopic}
          />
          <FilterRail
            label="Filter by time"
            options={WINDOWS}
            value={window}
            onChange={setWindow}
          />
        </div>
      </StickyPageHeader>

      {feed.isLoading ? (
        <FeedSkeleton />
      ) : feed.error ? (
        <p className="py-10 text-center text-[13.5px] text-muted">
          {(feed.error as Error).message}
        </p>
      ) : items.length === 0 ? (
        <EmptyFeed />
      ) : (
        <>
          {lead ? <LeadStory item={lead} window={window} /> : null}

          {accounts.length > 0 ? (
            <section className="mt-6">
              <SectionHead
                title="Robinhood socials"
                note="Straight from Robinhood"
              />
              <div
                className="rail -mx-[22px] flex gap-2.5 overflow-x-auto px-[22px] pb-1"
                aria-label="Robinhood socials"
              >
                {accounts.map((item) => (
                  <SourceCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          {rest.length > 0 ? (
            <section className="mt-6">
              <SectionHead
                title={lead ? "More stories" : "Stories"}
                note={`${articles.length} in view`}
              />
              <ul className="-mx-[22px]">
                {rest.map((item, i) => (
                  <StoryRow
                    key={item.id}
                    item={item}
                    window={window}
                    priority={i < 2}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {feed.error ? (
        <p className="mt-7 border-t border-hairline pt-4 text-[13px] text-muted">
          Could not load the news feed. Retrying.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The date line.
 *
 * Set after mount: a server render in one timezone and a client render in
 * another disagree on what day it is, and hydration would flag it.
 */
function Masthead() {
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    );
  }, []);

  return (
    <div className="mb-4">
      <div className="h-[15px] text-[11px] font-bold uppercase tracking-[0.1em] text-faint">
        {today}
      </div>
      <h1 className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.035em]">
        News
      </h1>
    </div>
  );
}

function SectionHead({title, note}: {title: string; note?: string}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[16px] font-extrabold tracking-[-0.025em]">{title}</h2>
      {note ? (
        <span className="shrink-0 text-[11.5px] font-semibold text-faint">
          {note}
        </span>
      ) : null}
    </div>
  );
}

function TopicChip({topic}: {topic: FeedItem["topic"]}) {
  const label =
    topic === "robinhood" ? "Robinhood" : topic === "market" ? "Markets" : "RWA";
  return (
    <span
      className={cn(
        "rounded-[5px] px-[6px] py-[3px] text-[9.5px] font-extrabold uppercase leading-none tracking-[0.07em]",
        topic === "robinhood"
          ? "bg-[rgba(0,200,5,0.14)] text-green-deep"
          : "bg-[var(--overlay-wash)] text-muted",
      )}
    >
      {label}
    </span>
  );
}

/**
 * A story's picture, or nothing.
 *
 * Publishers' image URLs rot, so a load failure falls back to no picture
 * rather than a broken one — and deliberately not to generated artwork. Around
 * a third of stories have no photograph to show, and filling those with a
 * coloured gradient made the feed look padded: the same abstract block over
 * and over reads as a placeholder, because it is one. A headline on its own is
 * what a news app does with a story that has no art.
 */
function StoryImage({
  item,
  className,
  priority = false,
}: {
  item: FeedItem;
  className?: string;
  /** Skips lazy-loading for art that is on screen the moment the tab opens. */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!item.imageUrl || failed) return null;

  return (
    // A muted panel fills this box the instant the story renders, so a slow
    // photo never leaves a flash of empty card behind the headline — it just
    // fades in over what was already there. `loading="lazy"` is right for
    // art below the fold, but the lead story's photo is the first thing on
    // screen, so deferring it the same way only added a wait nothing needed.
    <div className={cn("overflow-hidden bg-[var(--overlay-wash)]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.imageUrl}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/** The story at the top of the section, given the room a lead deserves. */
function LeadStory({item, window}: {item: FeedItem; window: NewsWindow}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-[20px] border border-hairline bg-card shadow-card transition-colors hover:border-[var(--border-hover-strong)]"
    >
      {item.imageUrl ? (
        <div className="relative">
          <StoryImage item={item} className="h-[176px] w-full" priority />
          <div className="absolute left-3.5 top-3.5">
            <TopicChip topic={item.topic} />
          </div>
        </div>
      ) : null}

      <div className="p-4">
        {item.imageUrl ? null : (
          <div className="mb-2.5">
            <TopicChip topic={item.topic} />
          </div>
        )}
        <h3 className="text-[19px] font-extrabold leading-[1.24] tracking-[-0.028em]">
          {item.body}
        </h3>
        <ByLine item={item} window={window} className="mt-2.5" />
        <TickerChips tickers={item.tickers} className="mt-3" />
      </div>
    </a>
  );
}

function StoryRow({
  item,
  window,
  priority = false,
}: {
  item: FeedItem;
  window: NewsWindow;
  priority?: boolean;
}) {
  return (
    <li>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3.5 px-[22px] py-3.5 transition-colors duration-150 hover:bg-[var(--overlay-wash)]"
      >
        <div className="min-w-0 flex-1">
          <TopicChip topic={item.topic} />
          <h3 className="mt-2 line-clamp-3 text-[15px] font-bold leading-[1.34] tracking-[-0.018em]">
            {item.body}
          </h3>
          <ByLine item={item} window={window} className="mt-2" />
        </div>

        <StoryImage
          item={item}
          className="h-[78px] w-[78px] shrink-0 rounded-[14px]"
          priority={priority}
        />
      </a>
    </li>
  );
}

function ByLine({
  item,
  window,
  className,
}: {
  item: FeedItem;
  window: NewsWindow;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[11.5px] font-semibold text-faint",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-[8px] font-extrabold text-muted"
      >
        {item.source.slice(0, 1)}
      </span>
      <span className="truncate text-muted">{item.source}</span>
      <span className="opacity-50">·</span>
      <span className="shrink-0">{newsTime(item.publishedAt, window)}</span>
    </div>
  );
}

function TickerChips({
  tickers,
  className,
}: {
  tickers: string[];
  className?: string;
}) {
  if (tickers.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tickers.map((ticker) => (
        <AssetLink
          key={ticker}
          kind="rwa"
          id={ticker}
          className="flex items-center gap-1 rounded-[7px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
        >
          {ticker}
          <VerifiedTick size={12} />
        </AssetLink>
      ))}
    </div>
  );
}

/**
 * A primary source rather than a story.
 *
 * Carries the account's most recent post, fetched from X, and links to that
 * post rather than to the profile. Nothing here is written for them: these are
 * real accounts belonging to real people, so the card shows what was actually
 * said or it shows nothing at all.
 */
function SourceCard({item}: {item: FeedItem}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex w-[210px] shrink-0 flex-col gap-2.5 rounded-[18px] p-3.5",
        "border border-[rgba(0,200,5,0.26)] bg-[rgba(0,200,5,0.05)]",
        "transition-transform duration-200 hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={item.source} src={item.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[13px] font-extrabold tracking-[-0.015em]">
              {item.source}
            </span>
            <VerifiedTick size={12} label="Verified account" />
          </div>
          <div className="truncate text-[11px] font-semibold text-faint">
            @{item.handle}
          </div>
        </div>
        <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-faint" />
      </div>
      <p className="line-clamp-2 text-[12px] font-medium leading-[1.45] text-muted">
        {item.body}
      </p>
    </a>
  );
}

function EmptyFeed() {
  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
        <NewsIcon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-[14px] font-bold">Nothing in this window</p>
      <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-[1.5] text-muted">
        Widen the time filter, or switch topic.
      </p>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div>
      <div className="h-[300px] animate-pulse rounded-[20px] bg-wash" />
      <div className="mt-6 space-y-4">
        {Array.from({length: 4}).map((_, i) => (
          <div key={i} className="flex gap-3.5">
            <div className="flex-1">
              <div className="h-3 w-14 animate-pulse rounded bg-wash" />
              <div className="mt-2.5 h-3.5 w-full animate-pulse rounded bg-wash" />
              <div className="mt-2 h-3.5 w-2/3 animate-pulse rounded bg-wash" />
            </div>
            <div className="h-[78px] w-[78px] shrink-0 animate-pulse rounded-[14px] bg-wash" />
          </div>
        ))}
      </div>
    </div>
  );
}
