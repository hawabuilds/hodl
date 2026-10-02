"use client";

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {usePathname, useRouter, useSearchParams} from "next/navigation";

import {useQuickBuy, useQuickBuySettings, type QuickBuyStatus} from "@/hooks/useQuickBuy";
import {useTokensTable} from "@/hooks/useTokensTable";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {MAX_SLIPPAGE_PCT} from "@/lib/localStore";
import {
  DEFAULT_ORDER,
  TOKENS_TABS,
  nextOrder,
  parseSort,
  parseTab,
  stableRows,
  type TokensColumnSort,
  type TokensOrder,
  type TokensTab,
  type TokensTableRow,
} from "@/lib/tokensTable";
import type {Launchpad} from "@/lib/types";
import {LaunchpadMark} from "../../LaunchpadMark";
import {ChevronDownIcon, CloseIcon} from "../../ui/Icons";
import {TABLE_COLUMNS, TokenTableRowView} from "./TokenTableRow";

/**
 * The desktop Tokens tab: one list of memecoins paired with real stocks,
 * sorted on the server and loaded as you scroll.
 *
 * Tab, sort and stock live in the URL, so a token page's back button returns
 * to the same view; loaded pages stay cached and the scroll position is put
 * back. While the cursor is over the list, rows update in place but keep
 * their order, so nothing moves under the pointer.
 */

const TAB_LABEL: Record<TokensTab, string> = {
  trending: "Trending",
  new: "New",
  following: "Following",
  watchlist: "Watchlist",
};

const TAB_NOTE: Record<TokensTab, string> = {
  trending: "Most traded in the last 24h",
  new: "Newest listings first",
  following: "Traded on HODL by people you follow, last 24h",
  watchlist: "Your starred tokens",
};

/** The two launchpads we index, for the key beside the tabs. */
const LAUNCHPAD_KEY: Launchpad[] = [
  {id: "pons", name: "Pons", color: "#6FA980", logoUrl: "/launchpads/pons.jpg", url: ""},
  {id: "long", name: "Long", color: "#79FF77", logoUrl: "/launchpads/long.svg", url: ""},
];

const COLUMNS: {key: TokensColumnSort | null; label: string; align: "start" | "center" | "end"}[] = [
  {key: null, label: "Token", align: "start"},
  {key: null, label: "Socials", align: "center"},
  {key: null, label: "", align: "start"},
  {key: "age", label: "Age", align: "end"},
  {key: "mcap", label: "Market cap", align: "end"},
  {key: "change", label: "24h", align: "center"},
  {key: "liq", label: "Liquidity", align: "end"},
  {key: "vol", label: "Volume 24h", align: "end"},
  {key: "txns", label: "Buys / Sells 24h", align: "end"},
  {key: null, label: "", align: "end"},
];

/** How many stocks show as chips before "More". */
const CHIP_COUNT = 8;
/** Scroll quiet time before live updates may reorder rows again. */
const SETTLE_MS = 1_500;

function useView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/tokens";
  const tab = parseTab(params.get("tab"));
  const sortParam = params.get("sort");
  const order: TokensOrder = sortParam
    ? {sort: parseSort(sortParam, tab), desc: params.get("dir") !== "asc"}
    : DEFAULT_ORDER[tab];
  const stock = params.get("stock");

  const set = useCallback(
    (next: {tab?: TokensTab; order?: TokensOrder | null; stock?: string | null}) => {
      const query = new URLSearchParams(params.toString());
      const nextTab = next.tab ?? tab;
      if (next.tab) {
        query.delete("sort");
        query.delete("dir");
      }
      if (nextTab === "trending") query.delete("tab");
      else query.set("tab", nextTab);
      if (next.order) {
        query.set("sort", next.order.sort);
        query.set("dir", next.order.desc ? "desc" : "asc");
      }
      if (next.stock !== undefined) {
        if (next.stock) query.set("stock", next.stock);
        else query.delete("stock");
      }
      const text = query.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, {scroll: false});
    },
    [params, pathname, router, tab],
  );

  return {tab, order, stock, set};
}

export function TokensTable() {
  const user = useUser();
  const {tab, order, stock, set} = useView();
  const table = useTokensTable({tab, order, stock});
  const viewKey = `${tab}:${order.sort}:${order.desc}:${stock ?? ""}`;

  // ── Frozen order while someone is reading ────────────────────────────────
  const [hovering, setHovering] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const frozen = hovering || scrolling;
  const [shown, setShown] = useState<TokensTableRow[]>(table.rows);
  const shownKey = useRef(viewKey);
  useEffect(() => {
    if (shownKey.current !== viewKey) {
      shownKey.current = viewKey;
      setShown(table.rows);
      return;
    }
    setShown((current) => stableRows(current, table.rows, frozen));
  }, [table.rows, frozen, viewKey]);

  // ── Scrolling: more rows near the end, and the position kept ─────────────
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const settle = useRef<number | null>(null);
  const restored = useRef<string | null>(null);
  const storageKey = `tokens-scroll:${viewKey}`;

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

  const {loadMore, hasMore} = table;
  useEffect(() => {
    const target = sentinel.current;
    const root = scroller.current;
    if (!target || !root || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      {root, rootMargin: "0px 0px 700px 0px"},
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, shown.length]);

  // ── Quick buy ────────────────────────────────────────────────────────────
  const settings = useQuickBuySettings();
  const quick = useQuickBuy();
  const [toast, setToast] = useState<QuickBuyStatus | null>(null);
  useEffect(() => {
    if (!toast || toast.kind === "working") return;
    const timer = window.setTimeout(() => setToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const onBuy = useCallback(
    (row: TokensTableRow) => {
      void quick.buy(row.asset, settings.amountUsd, settings.slippagePct, setToast);
    },
    [quick, settings.amountUsd, settings.slippagePct],
  );

  const empty = emptyText(tab, stock, user.authenticated);

  return (
    <div ref={scroller} onScroll={onScroll} className="scroll-quiet h-full overflow-y-auto">
      <div className="flex flex-col gap-[18px] px-8 pb-10 pt-7">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Tokens</h1>
            <p className="mt-1 text-[14px] text-muted">
              Memecoins paired with real stocks. Each one trades against the stock next to it.
            </p>
          </div>
          <QuickBuyBar
            amountUsd={settings.amountUsd}
            slippagePct={settings.slippagePct}
            onAmount={(amount) => void settings.setAmount(amount)}
            onSlippage={settings.setSlippage}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div role="tablist" aria-label="Token lists" className="flex gap-1 rounded-xl border border-[var(--overlay-wash)] bg-surface-base p-1">
            {TOKENS_TABS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => set({tab: value})}
                className={cn(
                  "rounded-[9px] px-4 py-[9px] text-[14px] transition-colors",
                  tab === value
                    ? "bg-[var(--overlay-wash-hover)] font-bold text-ink"
                    : "font-semibold text-faint hover:text-muted",
                )}
              >
                {TAB_LABEL[value]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-[13px] text-faint">
            {LAUNCHPAD_KEY.map((pad) => (
              <span key={pad.id} className="flex items-center gap-1.5">
                <LaunchpadMark launchpad={pad} size={14} className="!rounded-full" />
                {pad.name}
              </span>
            ))}
            <span aria-hidden="true" className="text-[var(--overlay-wash-hover)]">|</span>
            <span>{TAB_NOTE[tab]}</span>
          </div>
        </div>

        <PairChips
          pairs={table.pairs}
          stock={stock}
          onPick={(ticker) => set({stock: ticker})}
        />

        <section
          aria-label={`${TAB_LABEL[tab]} tokens`}
          className="rounded-[20px] border border-[var(--overlay-wash)] bg-surface-base"
        >
          <div
            role="row"
            className={cn(
              TABLE_COLUMNS,
              "sticky top-0 z-10 h-[46px] rounded-t-[20px] border-b border-[var(--overlay-wash)] bg-surface-base text-[12px] font-semibold text-faint",
            )}
          >
            {COLUMNS.map((column, index) =>
              column.key ? (
                <SortTitle
                  key={column.key}
                  label={column.label}
                  align={column.align}
                  active={order.sort === column.key}
                  desc={order.desc}
                  onClick={() => set({order: nextOrder(order, column.key!)})}
                />
              ) : (
                <span
                  key={index}
                  className={cn(column.align === "center" && "text-center", column.align === "end" && "text-right")}
                >
                  {column.label}
                </span>
              ),
            )}
          </div>

          <div
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            className={cn("transition-opacity", table.isSwitching && "opacity-60")}
          >
            {table.isLoading && shown.length === 0 ? (
              <SkeletonRows />
            ) : table.error && shown.length === 0 ? (
              <Note>
                Couldn&apos;t load tokens.{" "}
                <button type="button" onClick={table.retry} className="font-bold text-accent-link">
                  Retry
                </button>
              </Note>
            ) : shown.length === 0 ? (
              <Note>
                {empty}
                {tab === "following" && !user.authenticated ? (
                  <button
                    type="button"
                    onClick={() => user.login()}
                    className="ml-2 font-bold text-accent-link"
                  >
                    Sign in
                  </button>
                ) : null}
              </Note>
            ) : (
              shown.map((row) => (
                <TokenTableRowView
                  key={row.asset.address}
                  row={row}
                  buying={quick.busy === row.asset.address}
                  onBuy={onBuy}
                />
              ))
            )}
          </div>

          <div ref={sentinel} />
          {table.loadingMore || (hasMore && shown.length > 0) ? (
            <div className="flex items-center justify-center gap-2.5 px-5 py-4 text-[13px] text-faint" role="status">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-[3px] border-[var(--overlay-wash-hover)] border-t-brand-500"
              />
              Loading more…
            </div>
          ) : null}
        </section>
      </div>

      {toast ? <BuyToast status={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function emptyText(tab: TokensTab, stock: string | null, signedIn: boolean): string {
  if (stock) return `No tokens paired with ${stock} yet.`;
  if (tab === "following") {
    return signedIn
      ? "No trades yet from people you follow. When they trade on HODL, the tokens show up here."
      : "Sign in to see the tokens people you follow trade on HODL.";
  }
  if (tab === "watchlist") return "Star a token to add it here.";
  if (tab === "new") return "No new tokens yet.";
  return "No tokens traded in the last 24h.";
}

function SortTitle({
  label,
  align,
  active,
  desc,
  onClick,
}: {
  label: string;
  align: "start" | "center" | "end";
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  const arrows = (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true" className="shrink-0">
      <path d="M5 1L8.5 4.5H1.5z" className={active && !desc ? "fill-accent-link" : "fill-[var(--overlay-wash-hover)]"} />
      <path d="M5 11L1.5 7.5H8.5z" className={active && desc ? "fill-accent-link" : "fill-[var(--overlay-wash-hover)]"} />
    </svg>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}${active ? (desc ? ", high to low" : ", low to high") : ""}`}
      className={cn(
        "flex items-center gap-[5px] text-[12px] font-semibold transition-colors hover:text-muted",
        align === "end" && "justify-self-end",
        align === "center" && "justify-self-center",
        active ? "text-ink" : "text-faint",
      )}
    >
      {align === "center" ? (
        <>
          {label}
          {arrows}
        </>
      ) : (
        <>
          {arrows}
          {label}
        </>
      )}
    </button>
  );
}

function QuickBuyBar({
  amountUsd,
  slippagePct,
  onAmount,
  onSlippage,
}: {
  amountUsd: number;
  slippagePct: number;
  onAmount: (amount: number) => void;
  onSlippage: (pct: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base py-1.5 pl-3.5 pr-1.5">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="fill-[#FFD166]">
        <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
      </svg>
      <span className="text-[13px] font-semibold text-muted">Quick buy</span>
      <NumberBox
        label="Quick buy amount"
        prefix="$"
        value={amountUsd}
        width="w-[46px]"
        onCommit={(value) => {
          if (value > 0) onAmount(value);
        }}
      />
      <span className="ml-1 text-[13px] font-semibold text-muted">Slippage</span>
      <NumberBox
        label="Slippage percent"
        suffix="%"
        value={slippagePct}
        width="w-[30px]"
        onCommit={(value) => {
          if (value > 0 && value <= MAX_SLIPPAGE_PCT) onSlippage(value);
        }}
      />
    </div>
  );
}

/** A small inline number field that saves when you leave it or press Enter. */
function NumberBox({
  label,
  value,
  prefix,
  suffix,
  width,
  onCommit,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  width: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  const commit = () => {
    editing.current = false;
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0) onCommit(next);
    else setDraft(String(value));
  };
  return (
    <label className="flex items-center gap-1 rounded-[9px] border border-[var(--overlay-wash-hover)] bg-[var(--bg-input)] px-2.5 py-1.5 text-[13px] font-bold transition-colors focus-within:border-[rgb(171_174_245/38%)]">
      {prefix ? <span className="text-faint">{prefix}</span> : null}
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className={cn(width, "bg-transparent text-right font-bold tabular-nums text-ink outline-none")}
      />
      {suffix ? <span className="text-faint">{suffix}</span> : null}
    </label>
  );
}

function PairChips({
  pairs,
  stock,
  onPick,
}: {
  pairs: {ticker: string; count: number}[];
  stock: string | null;
  onPick: (ticker: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = pairs.reduce((sum, pair) => sum + pair.count, 0);
  const top = pairs.slice(0, CHIP_COUNT);
  // A chosen stock outside the top ones still shows as a chip.
  const picked = stock && !top.some((pair) => pair.ticker === stock)
    ? pairs.find((pair) => pair.ticker === stock) ?? {ticker: stock, count: 0}
    : null;
  const rest = pairs.slice(CHIP_COUNT);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[13px] text-faint">Paired with</span>
      <Chip active={!stock} label="All" count={total || null} onClick={() => onPick(null)} />
      {[...top, ...(picked ? [picked] : [])].map((pair) => (
        <Chip
          key={pair.ticker}
          active={stock === pair.ticker}
          label={pair.ticker}
          count={pair.count}
          onClick={() => onPick(pair.ticker)}
        />
      ))}
      {rest.length > 0 ? (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            className="flex items-center gap-1 rounded-full border border-[var(--overlay-wash)] px-3 py-[7px] text-[13px] font-semibold text-muted transition-colors hover:text-ink"
          >
            More
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
          {open ? (
            <div
              data-surface="popup"
              className="scroll-quiet absolute left-0 top-[calc(100%+6px)] z-30 grid max-h-[320px] w-[260px] grid-cols-2 gap-1 overflow-y-auto rounded-2xl bg-surface-popup p-2 shadow-panel"
            >
              {rest.map((pair) => (
                <button
                  key={pair.ticker}
                  type="button"
                  onClick={() => {
                    onPick(pair.ticker);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-[var(--overlay-wash)]"
                >
                  {pair.ticker}
                  <span className="text-[12px] font-medium text-faint">{pair.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-[7px] text-[13px] font-semibold transition-colors",
        active
          ? "border-[var(--overlay-wash-hover)] bg-[var(--overlay-wash-hover)] text-ink"
          : "border-[var(--overlay-wash)] text-muted hover:text-ink",
      )}
    >
      {label}
      {count != null ? <span className="text-[12px] font-medium text-faint">{count}</span> : null}
    </button>
  );
}

function Note({children}: {children: ReactNode}) {
  return <p className="px-6 py-14 text-center text-[14px] text-muted">{children}</p>;
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {Array.from({length: 10}).map((_, index) => (
        <div key={index} className={cn(TABLE_COLUMNS, "h-[62px]")}>
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 animate-pulse rounded-full bg-[var(--overlay-wash)]" />
            <span className="h-3.5 w-24 animate-pulse rounded bg-[var(--overlay-wash)]" />
          </div>
          {Array.from({length: 9}).map((__, cell) => (
            <span key={cell} className="h-3 w-full animate-pulse rounded bg-[var(--overlay-wash)] opacity-60" />
          ))}
        </div>
      ))}
    </div>
  );
}

function BuyToast({status, onClose}: {status: QuickBuyStatus; onClose: () => void}) {
  return (
    <div
      role="status"
      data-surface="popup"
      className="fixed bottom-[40px] right-5 z-[60] flex max-w-[380px] animate-rise items-start gap-2.5 rounded-2xl border border-[var(--overlay-wash-hover)] bg-[var(--bg-input)] py-3 pl-4 pr-2 shadow-panel"
    >
      {status.kind === "working" ? (
        <span
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-[3px] border-[var(--overlay-wash-hover)] border-t-brand-500"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
            status.kind === "done" ? "bg-price-up" : "bg-price-down",
          )}
        />
      )}
      <p className="min-w-0 flex-1 text-[13px] font-semibold leading-[1.45]">{status.text}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint hover:bg-[var(--overlay-wash)] hover:text-ink"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
