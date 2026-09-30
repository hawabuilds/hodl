"use client";

import {useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {AssetLink} from "@/components/AssetLink";
import {StickyPageHeader} from "@/components/AppShell";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {ColumnSegments} from "@/components/desktop/BoardColumn";
import {Avatar} from "@/components/ui/Avatar";
import {VerifiedTick} from "@/components/ui/Badges";
import {PriceDelta} from "@/components/ui/PriceDelta";
import {ArrowUpRightIcon, NewsIcon} from "@/components/ui/Icons";
import {useIsDesktop} from "@/hooks/useBreakpoint";
import {useMarket} from "@/hooks/useMarket";
import {useNewsFeed} from "@/hooks/useNewsFeed";
import {cn} from "@/lib/cn";
import {newsTime} from "@/lib/format";
import {formatPriceUsd} from "@/lib/priceState";
import {
  NEWS_DEFAULT_TOPIC,
  NEWS_DEFAULT_WINDOW,
  selectTodayStories,
} from "@/lib/newsWindow";
import {newsArticlePath} from "@/lib/routes";
import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";
import {NewsImage} from "@/components/ui/NewsImage";
import type {NewsThumbWidth} from "@/lib/newsThumb";

const WINDOWS: FilterOption<NewsWindow>[] = [
  {value: "latest", label: "Latest"},
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

export default function NewsPage() {
  const [window, setWindow] = useState<NewsWindow>(NEWS_DEFAULT_WINDOW);
  const [topic, setTopic] = useState<NewsTopic>(NEWS_DEFAULT_TOPIC);

  const feed = useNewsFeed(window, topic);
  const desktop = useIsDesktop();

  const items = useMemo(() => {
    const raw = feed.data?.items ?? [];
    if (window !== "24h") return raw;
    return selectTodayStories(raw);
  }, [feed.data?.items, window]);
  const accounts = items.filter((item) => item.kind === "account");
  const articles = items.filter((item) => item.kind === "article");
  const [lead, ...rest] = articles;

  if (desktop) {
    return (
      <DesktopNews
        topic={topic}
        onTopic={setTopic}
        window={window}
        onWindow={setWindow}
        isLoading={feed.isLoading}
        error={feed.error as Error | null}
        articles={articles}
        accounts={accounts}
      />
    );
  }

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
              <ul className="-mx-[22px] flex flex-col gap-px">
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
        <p className="mt-7 pt-4 text-[13px] text-muted">
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
function Masthead({className = "mb-4"}: {className?: string}) {
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
    <div className={className}>
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
          ? "bg-[var(--price-up-wash)] text-price-up"
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
  width = 720,
}: {
  item: FeedItem;
  className?: string;
  /** Our stored copy's width: 720 for leads and cards, 240 for small rows. */
  width?: NewsThumbWidth;
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
      <NewsImage
        src={item.imageUrl}
        width={width}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setLoaded(true)}
        onFail={() => setFailed(true)}
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
    <Link
      href={newsArticlePath(item.id)}
      className="block overflow-hidden rounded-2xl bg-input shadow-card transition-[background-color,box-shadow] hover:bg-[var(--overlay-wash)] hover:shadow-lift"
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
    </Link>
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
      <Link
        href={newsArticlePath(item.id)}
        className="flex items-start gap-3.5 px-[22px] py-[13px] transition-colors duration-150 hover:bg-[var(--overlay-wash)]"
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
          width={240}
        />
      </Link>
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
function SourceCard({item, fill = false}: {item: FeedItem; fill?: boolean}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex shrink-0 flex-col gap-2.5 rounded-[14px] p-3.5",
        fill ? "w-full" : "w-[210px]",
        "bg-input shadow-card",
        "transition-[background-color,box-shadow] duration-150",
        "hover:bg-[var(--overlay-wash)] hover:shadow-lift",
        "active:bg-[var(--overlay-wash-hover)]",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={item.source} src={item.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[13px] font-extrabold tracking-[-0.015em] text-ink">
              {item.source}
            </span>
            <VerifiedTick size={12} label="Verified account" />
          </div>
          <div className="truncate text-[11px] font-semibold text-faint">
            @{item.handle}
          </div>
        </div>
        <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-accent-link" />
      </div>
      <p className="line-clamp-2 text-[12px] font-normal leading-[1.45] text-muted">
        {item.body}
      </p>
    </a>
  );
}

/**
 * News on a desktop: a front page rather than a feed.
 *
 * The phone stacks one story under another because it has one column. With
 * the width of a monitor the lead story gets its picture beside it, the rest
 * sit three across, and a side column carries what a trader reads news for —
 * which stocks the stories are about, and what those stocks are doing.
 */
function DesktopNews({
  topic,
  onTopic,
  window,
  onWindow,
  isLoading,
  error,
  articles,
  accounts,
}: {
  topic: NewsTopic;
  onTopic: (topic: NewsTopic) => void;
  window: NewsWindow;
  onWindow: (window: NewsWindow) => void;
  isLoading: boolean;
  error: Error | null;
  articles: FeedItem[];
  accounts: FeedItem[];
}) {
  const [lead, ...rest] = articles;

  return (
    <div className="mx-auto w-full max-w-[1320px] px-6 pb-12 pt-[22px]">
      {/* Title, then the filters under it on one row, reading left to right
          the way the phone stacks them. Beside the title they floated at the
          far edge of the page, away from what they filter. */}
      <div className="mb-5">
        <Masthead className="mb-4" />
        <div className="flex flex-wrap items-center gap-2.5">
          <ColumnSegments
            label="Filter by topic"
            options={TOPICS}
            value={topic}
            onChange={onTopic}
            size="md"
          />
          <ColumnSegments
            label="Filter by time"
            options={WINDOWS}
            value={window}
            onChange={onWindow}
            size="md"
          />
        </div>
      </div>

      {isLoading ? (
        <FeedSkeleton />
      ) : error ? (
        <p className="py-10 text-center text-[13.5px] text-muted">{error.message}</p>
      ) : articles.length === 0 && accounts.length === 0 ? (
        <EmptyFeed />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-[22px]">
          <div className="min-w-0">
            {lead ? <DesktopLead item={lead} window={window} /> : null}

            {rest.length > 0 ? (
              <section className="mt-5">
                <SectionHead
                  title={lead ? "More stories" : "Stories"}
                  note={`${articles.length} in view`}
                />
                <ul className="grid grid-cols-2 gap-3.5 xl:grid-cols-3">
                  {rest.map((item, i) => (
                    <StoryCard
                      key={item.id}
                      item={item}
                      window={window}
                      priority={i < 3}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="sticky top-4 flex flex-col gap-3.5">
            <InTheNews articles={articles} />

            {accounts.length > 0 ? (
              <section className="rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base p-3.5">
                <SectionHead title="Robinhood socials" note="Straight from Robinhood" />
                <div className="flex flex-col gap-2.5">
                  {accounts.map((item) => (
                    <SourceCard key={item.id} item={item} fill />
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

/** The lead story, its picture beside the headline rather than above it. */
function DesktopLead({item, window}: {item: FeedItem; window: NewsWindow}) {
  return (
    <Link
      href={newsArticlePath(item.id)}
      className={cn(
        "flex overflow-hidden rounded-2xl bg-input shadow-card transition-[background-color,box-shadow] hover:bg-[var(--overlay-wash)] hover:shadow-lift",
        // Tall enough to show a photo properly; a headline alone needs no more
        // room than it takes.
        item.imageUrl && "min-h-[280px]",
      )}
    >
      <StoryImage item={item} className="w-[53%] shrink-0" priority />
      <div className="flex min-w-0 flex-1 flex-col items-start p-[22px]">
        <TopicChip topic={item.topic} />
        <h3 className="mb-3.5 mt-3 text-[24px] font-extrabold leading-[1.2] tracking-[-0.03em]">
          {item.body}
        </h3>
        <ByLine item={item} window={window} />
        <TickerChips tickers={item.tickers} className="mt-3" />
      </div>
    </Link>
  );
}

function StoryCard({
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
      <Link
        href={newsArticlePath(item.id)}
        className="flex h-full flex-col overflow-hidden rounded-[14px] bg-input shadow-card transition-[background-color,box-shadow] hover:bg-[var(--overlay-wash)] hover:shadow-lift"
      >
        <StoryImage item={item} className="h-[112px] w-full shrink-0" priority={priority} />
        <div className="flex flex-1 flex-col items-start px-3.5 pb-3.5 pt-3">
          <TopicChip topic={item.topic} />
          <h3 className="mb-2.5 mt-2 line-clamp-3 text-[14px] font-bold leading-[1.34] tracking-[-0.015em]">
            {item.body}
          </h3>
          <ByLine item={item} window={window} className="mt-auto" />
        </div>
      </Link>
    </li>
  );
}

/**
 * The stocks the stories in view are about, most-mentioned first, at their
 * live price. News moves prices, so the list is the bridge from reading to
 * the chart.
 */
function InTheNews({articles}: {articles: FeedItem[]}) {
  const market = useMarket();

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const article of articles) {
      for (const ticker of article.tickers) {
        counts.set(ticker, (counts.get(ticker) ?? 0) + 1);
      }
    }
    const byTicker = new Map(market.rwas.map((rwa) => [rwa.ticker, rwa]));
    return [...counts.entries()]
      .map(([ticker, stories]) => ({ticker, stories, rwa: byTicker.get(ticker)}))
      .filter((row) => row.rwa)
      .sort((a, b) => b.stories - a.stories)
      .slice(0, 6);
  }, [articles, market.rwas]);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base px-3.5 pb-1.5 pt-3.5">
      <SectionHead title="In the news" note="Stocks named in stories" />
      <ul>
        {rows.map(({ticker, stories, rwa}) => (
          <li key={ticker} className="border-t border-[var(--overlay-wash)] first:border-t-0">
            <AssetLink
              kind="rwa"
              id={ticker}
              className="-mx-2 flex items-center gap-2.5 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-[var(--overlay-wash)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[13.5px] font-extrabold">
                  {ticker}
                  <VerifiedTick size={12} />
                </div>
                <div className="text-[11px] font-semibold text-faint">
                  {stories} {stories === 1 ? "story" : "stories"}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular-nums text-[13px] font-extrabold">
                  {formatPriceUsd(rwa?.priceUsd ?? null)}
                </div>
                <PriceDelta value={rwa?.changePct ?? 0} className="text-[11.5px] font-bold" />
              </div>
            </AssetLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyFeed() {
  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--overlay-wash)] text-faint">
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
      <div className="h-[300px] animate-pulse rounded-2xl bg-input shadow-inset-soft" />
      <div className="mt-6 flex flex-col gap-px">
        {Array.from({length: 4}).map((_, i) => (
          <div key={i} className="flex gap-3.5 px-[22px] py-[13px]">
            <div className="flex-1">
              <div className="h-3 w-14 animate-pulse rounded bg-[var(--overlay-wash)]" />
              <div className="mt-2.5 h-3.5 w-full animate-pulse rounded bg-[var(--overlay-wash)]" />
              <div className="mt-2 h-3.5 w-2/3 animate-pulse rounded bg-[var(--overlay-wash)]" />
            </div>
            <div className="h-[78px] w-[78px] shrink-0 animate-pulse rounded-[14px] bg-[var(--overlay-wash)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
