"use client";

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react";
import Link from "next/link";
import {usePathname, useRouter, useSearchParams} from "next/navigation";

import {useRwasList, useRwasOverview} from "@/hooks/useRwasBoard";
import {cn} from "@/lib/cn";
import {formatVolumeUsd, formatPriceUsd} from "@/lib/priceState";
import {newsTime, relativeTime} from "@/lib/format";
import {assetPath, newsArticlePath} from "@/lib/routes";
import {
  RWA_CATEGORIES,
  RWA_SORTS,
  keepOrder,
  pairedLabel,
  parseCategory,
  parseRwaSort,
  sortLabel,
  type RwaBoardRow,
  type RwaCategory,
  type RwaNewsItem,
  type RwaPost,
  type RwaSort,
} from "@/lib/rwaBoard";
import type {RwaSession} from "@/lib/rwaMove";
import {Sparkline} from "../../Sparkline";
import {Avatar} from "../../ui/Avatar";
import {ChevronDownIcon, XIcon} from "../../ui/Icons";

/**
 * The desktop RWAs tab: the day's biggest real moves, what Robinhood is
 * posting, the latest stock news, and beside them every stock, sorted and
 * filtered on the server and loaded as the list scrolls.
 *
 * Every price and % on the page comes from one snapshot of the market (the
 * overview's `moves`), so the movers, the news and the list never disagree.
 */

type Move = {priceUsd: number | null; changePct: number | null};
type Moves = Record<string, Move>;

const SETTLE_MS = 1_500;

function useView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/rwas";
  const tab: "all" | "watchlist" = params.get("list") === "watchlist" ? "watchlist" : "all";
  const category = parseCategory(params.get("cat"));
  const sort = parseRwaSort(params.get("sort"));

  const set = useCallback(
    (next: {tab?: "all" | "watchlist"; category?: RwaCategory | "all"; sort?: RwaSort}) => {
      const query = new URLSearchParams(params.toString());
      const write = (name: string, value: string, fallback: string) =>
        value === fallback ? query.delete(name) : query.set(name, value);
      if (next.tab) write("list", next.tab, "all");
      if (next.category) write("cat", next.category, "all");
      if (next.sort) write("sort", next.sort, "popular");
      const text = query.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, {scroll: false});
    },
    [params, pathname, router],
  );
  return {tab, category, sort, set};
}

const sessionWord = (session: RwaSession) => (session === "today" ? "today" : "last session");

export function RwasBoard() {
  const overview = useRwasOverview();
  const session: RwaSession = overview.data?.session ?? "today";
  const moves: Moves = overview.data?.moves ?? {};

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)_400px] items-start gap-10 px-10 pb-10 pt-8">
      <div className="flex min-w-0 flex-col gap-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] font-extrabold leading-none tracking-[-0.025em]">RWAs</h1>
          <p className="text-[15px] text-muted">Real stocks you can trade any time, and the tokens paired with them.</p>
        </div>

        <Movers
          loading={overview.isPending}
          up={overview.data?.movers.up ?? []}
          down={overview.data?.movers.down ?? []}
          session={session}
          moves={moves}
        />
        <FromRobinhood posts={overview.data?.posts ?? []} />
        <News items={overview.data?.news ?? []} moves={moves} loading={overview.isPending} />
      </div>

      <StockList session={session} moves={moves} />
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function SectionTitle({children, right}: {children: ReactNode; right?: ReactNode}) {
  return (
    <div className="flex h-8 items-center justify-between gap-4">
      <h2 className="text-[20px] font-extrabold tracking-[-0.01em]">{children}</h2>
      {right}
    </div>
  );
}

function Pills<T extends string>({
  value,
  options,
  onPick,
  label,
}: {
  value: T;
  options: {id: T; label: string}[];
  onPick: (id: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onPick(option.id)}
          className={cn(
            "rounded-full px-3.5 py-[6px] text-[13px] transition-colors",
            value === option.id
              ? "bg-ink font-bold text-surface-base"
              : "border border-[var(--overlay-wash-hover)] font-semibold text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "+5.74%" in a tinted pill, green or red; "—" with no move. */
function ChangePill({value, size = "md"}: {value: number | null | undefined; size?: "sm" | "md"}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="tabular-nums text-[12px] font-bold text-faint">—</span>;
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "tabular-nums font-bold",
        size === "md" ? "rounded-lg px-2 py-1 text-[13px]" : "rounded-md px-[7px] py-[3px] text-[12px]",
        up
          ? "bg-[color-mix(in_srgb,var(--price-up)_14%,transparent)] text-price-up"
          : "bg-[color-mix(in_srgb,var(--price-down)_14%,transparent)] text-price-down",
      )}
    >
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function StockAvatar({row, size}: {row: Pick<RwaBoardRow, "ticker" | "logoUrl">; size: number}) {
  return <Avatar name={row.ticker} src={row.logoUrl} seed={row.ticker} size={size} />;
}

// ── Top movers ───────────────────────────────────────────────────────────────

function Movers({
  up,
  down,
  session,
  moves,
  loading,
}: {
  up: RwaBoardRow[];
  down: RwaBoardRow[];
  session: RwaSession;
  moves: Moves;
  loading: boolean;
}) {
  const [direction, setDirection] = useState<"up" | "down">("up");
  const list = direction === "up" ? up : down;
  return (
    <section aria-label="Top movers" className="flex flex-col gap-4">
      <SectionTitle
        right={
          <Pills
            label="Direction"
            value={direction}
            onPick={setDirection}
            options={[
              {id: "up", label: "Up"},
              {id: "down", label: "Down"},
            ]}
          />
        }
      >
        Top movers {sessionWord(session)}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {loading
          ? Array.from({length: 4}, (_, i) => (
              <div key={i} className="h-[158px] animate-pulse rounded-2xl border border-[var(--overlay-wash)] bg-surface-base" />
            ))
          : list.map((row) => {
              const move = moves[row.ticker] ?? row;
              const upMove = (move.changePct ?? 0) >= 0;
              return (
                <Link
                  key={row.ticker}
                  href={assetPath("rwa", row.id)}
                  className="flex flex-col gap-4 rounded-2xl border border-[var(--overlay-wash)] bg-surface-base p-[18px] transition-colors hover:border-[var(--overlay-wash-hover)] hover:bg-[var(--overlay-wash)]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StockAvatar row={row} size={36} />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[15px] font-extrabold">{row.ticker}</span>
                      <span className="truncate text-[12px] text-muted">{row.name}</span>
                    </div>
                  </div>
                  <div className="h-9">
                    <Sparkline series={row.series} positive={upMove} height={36} className="h-9 w-full" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums text-[16px] font-bold">{formatPriceUsd(move.priceUsd)}</span>
                    <ChangePill value={move.changePct} />
                  </div>
                </Link>
              );
            })}
        {!loading && list.length === 0 ? (
          <p className="col-span-full py-6 text-center text-[14px] text-faint">
            No stocks {direction === "up" ? "up" : "down"} {sessionWord(session)}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ── From Robinhood ───────────────────────────────────────────────────────────

const POST_FILTERS = [
  {id: "all", label: "All"},
  {id: "RobinhoodApp", label: "Robinhood"},
  {id: "vladtenev", label: "Vlad"},
] as const;
type PostFilter = (typeof POST_FILTERS)[number]["id"];

/** Hidden entirely when there are no posts — say, while X credits are out. */
function FromRobinhood({posts}: {posts: RwaPost[]}) {
  const [filter, setFilter] = useState<PostFilter>("all");
  if (posts.length === 0) return null;
  const shown = posts
    .filter((post) => filter === "all" || post.handle.toLowerCase() === filter.toLowerCase())
    .slice(0, 3);
  return (
    <section aria-label="From Robinhood" className="flex flex-col gap-4">
      <SectionTitle right={<Pills label="Account" value={filter} onPick={setFilter} options={[...POST_FILTERS]} />}>
        From Robinhood
      </SectionTitle>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {shown.map((post) => (
          <article
            key={post.id}
            className="flex h-[196px] flex-col gap-3.5 rounded-2xl border border-[var(--overlay-wash)] bg-surface-base p-[18px]"
          >
            <div className="flex items-center gap-2.5">
              <Avatar name={post.name} src={post.avatarUrl} seed={post.handle} size={36} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-extrabold">{post.name}</span>
                <span className="flex min-w-0 gap-1 text-[12px] text-muted">
                  <span className="truncate">@{post.handle}</span>
                  <span className="shrink-0">· {relativeTime(post.publishedAt)}</span>
                </span>
              </div>
              <XIcon aria-hidden="true" style={{width: 14, height: 14}} className="shrink-0 text-muted" />
            </div>
            <p className="line-clamp-3 text-[14px] leading-[1.45] text-ink/85">{post.text}</p>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto text-[13px] font-bold text-accent-link hover:underline"
            >
              View on X
            </a>
          </article>
        ))}
        {shown.length === 0 ? (
          <p className="col-span-full py-6 text-center text-[14px] text-faint">No recent posts.</p>
        ) : null}
      </div>
    </section>
  );
}

// ── News ─────────────────────────────────────────────────────────────────────

function News({items, moves, loading}: {items: RwaNewsItem[]; moves: Moves; loading: boolean}) {
  const router = useRouter();
  if (!loading && items.length === 0) return null;
  return (
    <section aria-label="News" className="flex flex-col">
      <SectionTitle
        right={
          <Link href="/news" className="text-[14px] font-bold text-accent-link hover:underline">
            See all
          </Link>
        }
      >
        News
      </SectionTitle>
      <div className="mt-3">
        {loading
          ? Array.from({length: 3}, (_, i) => (
              <div key={i} className="h-[124px] animate-pulse border-t border-[var(--overlay-wash)]" />
            ))
          : items.map((item) => {
              const change = item.ticker ? (moves[item.ticker]?.changePct ?? item.changePct) : null;
              return (
                <div
                  key={item.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(newsArticlePath(item.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(newsArticlePath(item.id));
                  }}
                  className="group flex h-[124px] cursor-pointer items-center gap-5 border-t border-[var(--overlay-wash)] py-[18px]"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-[13px] font-semibold text-muted">
                      {item.source} <span className="font-normal text-faint">· {newsTime(item.publishedAt, "24h")}</span>
                    </span>
                    <span className="line-clamp-2 text-[16px] font-bold leading-[1.35] group-hover:text-accent-link">
                      {item.headline}
                    </span>
                    {item.ticker ? (
                      <span className="text-[13px]">
                        <Link
                          href={assetPath("rwa", item.ticker.toLowerCase())}
                          onClick={(event) => event.stopPropagation()}
                          className="font-bold hover:text-accent-link"
                        >
                          {item.ticker}
                        </Link>{" "}
                        <span
                          className={cn(
                            "tabular-nums font-bold",
                            change == null ? "text-faint" : change >= 0 ? "text-price-up" : "text-price-down",
                          )}
                        >
                          {change == null ? "—" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)}%`}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <div className="grid h-[84px] w-[120px] shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--overlay-wash)]">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- publisher artwork from any host
                      <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : item.ticker ? (
                      // No artwork of its own: the stock's logo stands in.
                      <Avatar name={item.ticker} src={item.logoUrl} seed={item.ticker} size={40} />
                    ) : null}
                  </div>
                </div>
              );
            })}
      </div>
    </section>
  );
}

// ── The stock list ───────────────────────────────────────────────────────────

function Menu<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: {id: T; label: string; count?: number}[];
  onPick: (id: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const current = options.find((option) => option.id === value);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1.5 rounded-[9px] border border-[var(--overlay-wash-hover)] bg-[var(--overlay-wash)] px-2.5 py-1.5 text-[13px] font-bold text-ink hover:bg-[var(--overlay-wash-hover)]"
      >
        {label}: {current?.label}
        <ChevronDownIcon aria-hidden="true" style={{width: 12, height: 12}} className="text-muted" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={label}
          data-surface="popup"
          className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[220px] rounded-xl bg-surface-popup p-1.5 shadow-panel"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => {
                onPick(option.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--overlay-wash)]",
                option.id === value ? "font-bold text-ink" : "font-semibold text-muted",
              )}
            >
              {option.label}
              {option.count != null ? <span className="tabular-nums font-semibold text-faint">{option.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StockList({session, moves}: {session: RwaSession; moves: Moves}) {
  const {tab, category, sort, set} = useView();
  const list = useRwasList({tab, category, sort});
  const viewKey = `${tab}:${category}:${sort}`;

  // While the pointer is over the list or it is scrolling, rows update in
  // place but keep their order, so nothing moves under the cursor.
  const [hovering, setHovering] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const frozen = hovering || scrolling;
  const [shown, setShown] = useState<RwaBoardRow[]>(list.rows);
  const shownKey = useRef(viewKey);
  useEffect(() => {
    if (shownKey.current !== viewKey) {
      shownKey.current = viewKey;
      setShown(list.rows);
      return;
    }
    setShown((current) => keepOrder(current, list.rows, frozen));
  }, [list.rows, frozen, viewKey]);

  // More rows near the end, and the scroll position kept for the back button.
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const settle = useRef<number | null>(null);
  const restored = useRef<string | null>(null);
  const storageKey = `rwas-scroll:${viewKey}`;
  const onScroll = useCallback(() => {
    setScrolling(true);
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setScrolling(false), SETTLE_MS);
    try {
      sessionStorage.setItem(storageKey, String(scroller.current?.scrollTop ?? 0));
    } catch {
      // Storage can be off; the position is a convenience.
    }
  }, [storageKey]);
  useLayoutEffect(() => {
    if (restored.current === viewKey || shown.length === 0 || !scroller.current) return;
    restored.current = viewKey;
    let top = 0;
    try {
      top = Number(sessionStorage.getItem(storageKey) ?? 0) || 0;
    } catch {
      top = 0;
    }
    scroller.current.scrollTop = top;
  }, [shown.length, storageKey, viewKey]);

  const {loadMore, hasMore} = list;
  useEffect(() => {
    const target = sentinel.current;
    const root = scroller.current;
    if (!target || !root || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      {root, rootMargin: "0px 0px 400px 0px"},
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, shown.length]);

  const counts = list.counts;
  const categoryOptions = [
    {id: "all" as const, label: "All", count: counts?.all},
    ...RWA_CATEGORIES.map((entry) => ({id: entry.id, label: entry.label, count: counts?.[entry.id]})),
  ];
  const sortOptions = RWA_SORTS.map((entry) => ({id: entry.id, label: sortLabel(entry.id, session)}));
  const categoryName = RWA_CATEGORIES.find((entry) => entry.id === category)?.label;

  const empty =
    tab === "watchlist" && list.watchCount === 0
      ? "Star a stock to add it here."
      : tab === "watchlist"
        ? `No ${categoryName ?? ""} stocks on your watchlist.`.replace("  ", " ")
        : `No stocks in ${categoryName ?? "this category"}.`;

  return (
    <aside
      aria-label="All stocks"
      className="sticky top-8 flex max-h-[calc(100dvh-160px)] flex-col overflow-hidden rounded-[20px] border border-[var(--overlay-wash)] bg-surface-base"
    >
      <div role="tablist" aria-label="Stock lists" className="flex h-14 shrink-0 items-end gap-[22px] border-b border-[var(--overlay-wash)] px-5">
        {(
          [
            {id: "all", label: "All", count: tab === "all" ? (counts?.all ?? null) : Object.keys(moves).length || null},
            {id: "watchlist", label: "Watchlist", count: list.watchCount},
          ] as const
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => set({tab: entry.id})}
            className={cn(
              "-mb-px border-b-2 pb-3.5 text-[15px] transition-colors",
              tab === entry.id ? "border-brand-500 font-extrabold text-ink" : "border-transparent font-bold text-muted hover:text-ink",
            )}
          >
            {entry.label}{" "}
            {entry.count != null ? <span className="font-semibold text-faint">{entry.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--overlay-wash)] px-5 py-3">
        <Menu label="Category" value={category} options={categoryOptions} onPick={(id) => set({category: id})} />
        <Menu label="Sort" value={sort} options={sortOptions} onPick={(id) => set({sort: id})} />
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={cn("scroll-quiet min-h-0 flex-1 overflow-y-auto transition-opacity", list.isSwitching && "opacity-60")}
      >
        {list.isLoading && shown.length === 0 ? (
          Array.from({length: 8}, (_, i) => (
            <div key={i} className="flex h-16 items-center gap-3 px-5">
              <span className="h-9 w-9 animate-pulse rounded-full bg-[var(--overlay-wash)]" />
              <span className="h-3 w-32 animate-pulse rounded bg-[var(--overlay-wash)]" />
            </div>
          ))
        ) : list.error && shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-[14px] text-faint">
            Couldn&apos;t load stocks.{" "}
            <button type="button" onClick={list.retry} className="font-bold text-accent-link">
              Retry
            </button>
          </p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-[14px] text-faint">{empty}</p>
        ) : (
          shown.map((row) => <StockRow key={row.ticker} row={row} sort={sort} move={moves[row.ticker]} />)
        )}
        <div ref={sentinel} />
        {list.loadingMore || (hasMore && shown.length > 0) ? (
          <div className="flex items-center justify-center gap-2.5 px-5 py-4 text-[13px] text-faint" role="status">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-[3px] border-[var(--overlay-wash-hover)] border-t-brand-500"
            />
            Loading more as you scroll
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** What the name line adds when the list is sorted by something not otherwise on the row. */
function sortedFact(row: RwaBoardRow, sort: RwaSort): string | null {
  if (sort === "volume") return row.volumeUsd != null ? `Volume ${formatVolumeUsd(row.volumeUsd)}` : null;
  if (sort === "mcap") return row.marketCapUsd != null ? `Market cap ${formatVolumeUsd(row.marketCapUsd)}` : null;
  return null;
}

function StockRow({row, sort, move}: {row: RwaBoardRow; sort: RwaSort; move: Move | undefined}) {
  const router = useRouter();
  const href = assetPath("rwa", row.id);
  const price = move?.priceUsd ?? row.priceUsd;
  const change = move?.changePct ?? row.changePct;
  const fact = sortedFact(row, sort);
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter") router.push(href);
      }}
      className="grid h-16 cursor-pointer grid-cols-[36px_minmax(0,1fr)_56px_84px] items-center gap-3 px-5 transition-colors hover:bg-[var(--overlay-wash)] focus-visible:bg-[var(--overlay-wash)] focus-visible:outline-none"
    >
      <StockAvatar row={row} size={36} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[14px] font-extrabold">{row.ticker}</span>
          {row.pairedTokens > 0 ? (
            <button
              type="button"
              title={`Tokens paired with ${row.ticker} that traded in the last 24h`}
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/tokens?stock=${encodeURIComponent(row.ticker)}`);
              }}
              className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--brand-500)_16%,transparent)] px-1.5 py-0.5 text-[11px] font-bold text-accent-link hover:bg-[color-mix(in_srgb,var(--brand-500)_28%,transparent)]"
            >
              {pairedLabel(row.pairedTokens)}
            </button>
          ) : null}
        </span>
        <span className="truncate text-[12px] text-muted">
          {row.name}
          {fact ? <span className="text-faint"> · {fact}</span> : null}
        </span>
      </div>
      <div className="h-6 w-14">
        <Sparkline series={row.series} positive={(change ?? 0) >= 0} height={24} className="h-6 w-14" />
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="tabular-nums text-[14px] font-bold">{formatPriceUsd(price)}</span>
        <ChangePill value={change} size="sm" />
      </div>
    </div>
  );
}
