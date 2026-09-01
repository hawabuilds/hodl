"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {CoverArt} from "@/components/CoverArt";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {Avatar} from "@/components/ui/Avatar";
import {VerifiedTick} from "@/components/ui/Badges";
import {ArrowUpRightIcon, NewsIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import {relativeTime} from "@/lib/format";
import {assetPath} from "@/lib/routes";
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
  {value: "posts", label: "Sources"},
];

interface FeedResponse {
  items: FeedItem[];
  seeded: boolean;
}

export default function NewsPage() {
  const [window, setWindow] = useState<NewsWindow>("7d");
  const [topic, setTopic] = useState<NewsTopic>("all");

  const feed = useQuery({
    queryKey: ["news-feed", window, topic],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/news?window=${window}&topic=${topic}`);
      if (!res.ok) throw new Error("Could not load the news feed.");
      return (await res.json()) as FeedResponse;
    },
  });

  const items = feed.data?.items ?? [];
  const accounts = items.filter((item) => item.kind === "account");
  const articles = items.filter((item) => item.kind === "article");
  const [lead, ...rest] = articles;

  return (
    <div>
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
          {lead ? <LeadStory item={lead} /> : null}

          {accounts.length > 0 ? (
            <section className="mt-6">
              <SectionHead
                title="Sources"
                note="Straight from Robinhood"
              />
              <div className="rail -mx-[22px] flex gap-2.5 overflow-x-auto px-[22px] pb-1">
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
                {rest.map((item) => (
                  <StoryRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {feed.data?.seeded ? (
        <p className="mt-7 border-t border-hairline pt-4 text-[11.5px] leading-[1.55] text-faint">
          Sample coverage, written to templates and credited to outlets that do
          not exist, so nothing here can be mistaken for reporting. The source
          accounts are real and link out — their posts arrive once a provider is
          connected.
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
  return (
    <span
      className={cn(
        "rounded-[5px] px-[6px] py-[3px] text-[9.5px] font-extrabold uppercase leading-none tracking-[0.07em]",
        topic === "robinhood"
          ? "bg-[rgba(0,200,5,0.14)] text-green-deep"
          : "bg-[var(--overlay-wash)] text-muted",
      )}
    >
      {topic === "robinhood" ? "Robinhood" : "RWA"}
    </span>
  );
}

/** The story at the top of the section, given the room a lead deserves. */
function LeadStory({item}: {item: FeedItem}) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-hairline bg-card shadow-card">
      <div className="relative">
        <CoverArt
          seed={item.id}
          label={item.tickers[0]}
          brand={item.topic === "robinhood"}
          className="h-[176px] w-full"
          labelClassName="text-[13px]"
        />
        <div className="absolute left-3.5 top-3.5">
          <TopicChip topic={item.topic} />
        </div>
      </div>

      <div className="p-4">
        <h3 className="text-[19px] font-extrabold leading-[1.24] tracking-[-0.028em]">
          {item.body}
        </h3>
        <ByLine item={item} className="mt-2.5" />
        <TickerChips tickers={item.tickers} className="mt-3" />
      </div>
    </article>
  );
}

function StoryRow({item}: {item: FeedItem}) {
  return (
    <li>
      <article className="flex items-start gap-3.5 px-[22px] py-3.5 transition-colors duration-150 hover:bg-[var(--overlay-wash)]">
        <div className="min-w-0 flex-1">
          <TopicChip topic={item.topic} />
          <h3 className="mt-2 line-clamp-3 text-[15px] font-bold leading-[1.34] tracking-[-0.018em]">
            {item.body}
          </h3>
          <ByLine item={item} className="mt-2" />
        </div>

        <CoverArt
          seed={item.id}
          label={item.tickers[0]}
          brand={item.topic === "robinhood"}
          className="h-[78px] w-[78px] shrink-0 rounded-[14px]"
        />
      </article>
    </li>
  );
}

function ByLine({item, className}: {item: FeedItem; className?: string}) {
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
      <span className="shrink-0">{relativeTime(item.publishedAt)}</span>
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
        <Link
          key={ticker}
          href={assetPath("rwa", ticker)}
          className="flex items-center gap-1 rounded-[7px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
        >
          {ticker}
          <VerifiedTick size={12} />
        </Link>
      ))}
    </div>
  );
}

/**
 * A primary source rather than a story.
 *
 * Carries no post text at all: these are real accounts belonging to real
 * people, and inventing something for them to have said would be a fabricated
 * record however clearly the rest of the feed is labelled. The card links out
 * so the actual account is one tap away in the meantime.
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
        <Avatar name={item.source} size={32} />
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
