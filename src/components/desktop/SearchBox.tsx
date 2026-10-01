"use client";

import {useEffect, useRef, useState, type KeyboardEvent} from "react";
import {usePathname} from "next/navigation";

import {AssetList} from "../AssetRow";
import {PersonRow} from "../PersonRow";
import {SearchIcon} from "../ui/Icons";
import {useMarket} from "@/hooks/useMarket";
import {useSearch} from "@/hooks/useSearch";
import {cn} from "@/lib/cn";

/**
 * Search in the top bar, answered in place.
 *
 * On a phone search is a tab of its own. In a terminal it is a box you type
 * into from wherever you are, with the answers dropping down under it, so
 * looking something up never costs you the page you were on.
 */
export function SearchBox() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };

  // Picking a result navigates, and arriving somewhere new is the end of the
  // search.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  // `/` to search, the convention every terminal and most of the web shares.
  // Ignored while typing, so a slash in a comment stays a slash.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typing(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const links = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);

  // Arrow keys walk the results the way they would a menu; Enter on the box
  // opens the first one.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const all = links();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      all[Math.min(at + 1, all.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (at <= 0) inputRef.current?.focus();
      else all[at - 1]?.focus();
    } else if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      all[0]?.click();
    }
  };

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="relative w-full"
    >
      <label
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-full bg-[var(--bg-input)] px-3.5 text-[13px] font-medium shadow-inset-soft transition-shadow",
          open && "ring-1 ring-[var(--border-hover-strong)]",
        )}
      >
        <SearchIcon className="h-[15px] w-[15px] shrink-0 text-faint" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search tokens, RWAs, people"
          aria-label="Search tokens, RWAs and people"
          aria-expanded={open}
          aria-controls="topbar-search-results"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint focus:outline-none focus-visible:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="text-[11px] font-bold text-faint transition-colors hover:text-ink"
          >
            Clear
          </button>
        ) : (
          <kbd className="rounded-md bg-[var(--overlay-wash)] px-[7px] py-[2px] font-sans text-[11px] font-semibold text-faint">
            /
          </kbd>
        )}
      </label>

      {open ? (
        <div
          ref={panelRef}
          id="topbar-search-results"
          data-surface="popup"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) close();
          }}
          className="scroll-quiet absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(640px,calc(100dvh-120px))] min-w-[420px] overflow-y-auto rounded-2xl bg-surface-popup py-1.5 shadow-panel [--avatar-ring:var(--surface-popup)]"
        >
          <SearchResults query={query} />
        </div>
      ) : null}
    </div>
  );
}

/** Mounted only while the dropdown is open, so a closed box polls nothing. */
function SearchResults({query}: {query: string}) {
  const {search, trimmed, active} = useSearch(query);
  const market = useMarket();

  if (!active) {
    const trending = [...market.rwas.slice(0, 4), ...market.tokens.slice(0, 4)];
    return (
      <>
        <Label>TRENDING</Label>
        {market.isLoading ? <Note>Loading…</Note> : <AssetList assets={trending} flush dense />}
      </>
    );
  }

  if (search.isLoading) return <Note>Searching…</Note>;
  if (search.error) return <Note>Search failed. Try again in a moment.</Note>;

  const rwas = search.data?.rwas ?? [];
  const tokens = search.data?.tokens ?? [];
  const people = search.data?.people ?? [];

  if (rwas.length + tokens.length + people.length === 0) {
    return (
      <Note>
        {search.data?.ineligible
          ? "That contract exists, but it is not a Pons or Long token paired against an RWA or paying holders in one."
          : `Nothing matches “${trimmed}”. Try a ticker, a token symbol, a contract address or a handle.`}
      </Note>
    );
  }

  return (
    <>
      {rwas.length > 0 ? (
        <>
          <Label>RWAS</Label>
          <AssetList assets={rwas} flush dense />
        </>
      ) : null}
      {tokens.length > 0 ? (
        <>
          <Label>TOKENS</Label>
          <AssetList assets={tokens} flush dense />
        </>
      ) : null}
      {people.length > 0 ? (
        <>
          <Label>PEOPLE</Label>
          <ul>
            {people.map((person) => (
              <PersonRow key={person.handle} person={person} dense />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function Label({children}: {children: string}) {
  return (
    <div className="px-3.5 pb-1 pt-3 text-[11px] font-bold tracking-[0.09em] text-faint">
      {children}
    </div>
  );
}

function Note({children}: {children: React.ReactNode}) {
  return (
    <p className="px-4 py-6 text-center text-[13px] leading-[1.5] text-muted">{children}</p>
  );
}

/** Is the key press someone typing, rather than a shortcut? */
export function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
