"use client";

import {useState} from "react";
import {cn} from "@/lib/cn";
import {compactMoney} from "@/lib/format";
import {FEED_WINDOWS, type FeedWindow, type TokenAsset} from "@/lib/types";
import {FilterIcon} from "./ui/Icons";

/**
 * The feed's custom filters.
 *
 * Separate from the sort rail beside it: the rail picks one ordering, this
 * narrows what is in the list at all. Ranges are open-ended on both sides —
 * "over $100k" is a far more common thing to want than a band, and requiring
 * both ends would make the simple case the awkward one.
 */

export interface FeedFilterState {
  /** Which window volume and price move are read over. */
  window: FeedWindow;
  minMarketCap: number | null;
  maxMarketCap: number | null;
  minVolume: number | null;
  maxVolume: number | null;
  /** Age of the token, in hours since its pool opened. */
  minAgeHours: number | null;
  maxAgeHours: number | null;
}

export const NO_FILTERS: FeedFilterState = {
  window: "24h",
  minMarketCap: null,
  maxMarketCap: null,
  minVolume: null,
  maxVolume: null,
  minAgeHours: null,
  maxAgeHours: null,
};

/** How many ranges are set, for the dot on the button. */
export function activeFilterCount(state: FeedFilterState): number {
  const pairs: [number | null, number | null][] = [
    [state.minMarketCap, state.maxMarketCap],
    [state.minVolume, state.maxVolume],
    [state.minAgeHours, state.maxAgeHours],
  ];
  let count = pairs.filter(([lo, hi]) => lo !== null || hi !== null).length;
  if (state.window !== NO_FILTERS.window) count += 1;
  return count;
}

const hoursSince = (iso: string, now: number): number =>
  (now - Date.parse(iso)) / 3_600_000;

/** Whether one token survives the filters. */
export function passesFilters(
  token: TokenAsset,
  state: FeedFilterState,
  now: number = Date.now(),
): boolean {
  const volume = token.windows[state.window].volumeUsd;
  const age = hoursSince(token.createdAt, now);

  const within = (
    value: number,
    min: number | null,
    max: number | null,
  ): boolean =>
    (min === null || value >= min) && (max === null || value <= max);

  return (
    within(token.marketCapUsd, state.minMarketCap, state.maxMarketCap) &&
    within(volume, state.minVolume, state.maxVolume) &&
    within(age, state.minAgeHours, state.maxAgeHours)
  );
}

export function FeedFilterButton({
  state,
  onChange,
}: {
  state: FeedFilterState;
  onChange: (next: FeedFilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(state);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
        className={cn(
          "relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]",
          "transition-colors",
          count > 0
            ? "bg-ink text-premium-bg"
            : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
        )}
      >
        <FilterIcon className="h-[15px] w-[15px]" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full bg-green ring-2 ring-[var(--premium-bg)]" />
        ) : null}
      </button>

      {open ? (
        <FilterSheet
          state={state}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function FilterSheet({
  state,
  onChange,
  onClose,
}: {
  state: FeedFilterState;
  onChange: (next: FeedFilterState) => void;
  onClose: () => void;
}) {
  // Edited locally so half-typed numbers do not re-filter the feed under the
  // sheet on every keystroke.
  const [draft, setDraft] = useState(state);

  const set = (patch: Partial<FeedFilterState>) =>
    setDraft((current) => ({...current, ...patch}));

  const apply = () => {
    onChange(draft);
    onClose();
  };

  const clear = () => {
    setDraft(NO_FILTERS);
    onChange(NO_FILTERS);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-label="Feed filters"
        className="relative w-full max-w-[380px] overflow-hidden rounded-[20px] border border-hairline bg-card p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">
            Filters
          </h2>
          <button
            type="button"
            onClick={clear}
            className="text-[12px] font-bold text-faint transition-colors hover:text-ink"
          >
            Reset
          </button>
        </div>

        <Section label="Time range">
          <div className="flex gap-1.5">
            {FEED_WINDOWS.map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => set({window})}
                aria-pressed={draft.window === window}
                className={cn(
                  "flex-1 rounded-[9px] py-2 text-[12.5px] font-extrabold transition-colors",
                  draft.window === window
                    ? "bg-ink text-premium-bg"
                    : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                )}
              >
                {window}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.45] text-faint">
            Volume and price move are read over this window.
          </p>
        </Section>

        <Section label="Market cap">
          <RangeInputs
            min={draft.minMarketCap}
            max={draft.maxMarketCap}
            onMin={(value) => set({minMarketCap: value})}
            onMax={(value) => set({maxMarketCap: value})}
            placeholderMin="No min"
            placeholderMax="No max"
            prefix="$"
          />
        </Section>

        <Section label={`Volume (${draft.window})`}>
          <RangeInputs
            min={draft.minVolume}
            max={draft.maxVolume}
            onMin={(value) => set({minVolume: value})}
            onMax={(value) => set({maxVolume: value})}
            placeholderMin="No min"
            placeholderMax="No max"
            prefix="$"
          />
        </Section>

        <Section label="Age">
          <RangeInputs
            min={draft.minAgeHours}
            max={draft.maxAgeHours}
            onMin={(value) => set({minAgeHours: value})}
            onMax={(value) => set({maxAgeHours: value})}
            placeholderMin="No min"
            placeholderMax="No max"
            suffix="h"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              {label: "Under 1h", max: 1},
              {label: "Under 24h", max: 24},
              {label: "Under 7d", max: 24 * 7},
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => set({minAgeHours: null, maxAgeHours: preset.max})}
                className="rounded-[7px] bg-[var(--overlay-wash)] px-2.5 py-1.5 text-[11.5px] font-bold text-muted transition-colors hover:text-ink"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Section>

        <button
          type="button"
          onClick={apply}
          className="mt-5 w-full rounded-[12px] bg-green py-3 text-[14px] font-extrabold text-white transition-opacity hover:opacity-90"
        >
          Show results
        </button>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * A pair of open-ended bounds.
 *
 * Empty means unbounded rather than zero, so the value is `null` and not `0` —
 * a min of zero would silently exclude nothing while looking like a filter.
 */
function RangeInputs({
  min,
  max,
  onMin,
  onMax,
  placeholderMin,
  placeholderMax,
  prefix,
  suffix,
}: {
  min: number | null;
  max: number | null;
  onMin: (value: number | null) => void;
  onMax: (value: number | null) => void;
  placeholderMin: string;
  placeholderMax: string;
  prefix?: string;
  suffix?: string;
}) {
  const parse = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  const field = (
    value: number | null,
    onValue: (next: number | null) => void,
    placeholder: string,
  ) => (
    <label className="flex flex-1 items-center gap-1 rounded-[10px] bg-[var(--overlay-wash)] px-2.5 py-2 transition-shadow focus-within:ring-1 focus-within:ring-[var(--border-hover-strong)]">
      {prefix ? (
        <span className="text-[12px] font-bold text-faint">{prefix}</span>
      ) : null}
      <input
        type="text"
        inputMode="decimal"
        value={value === null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(event) => onValue(parse(event.target.value))}
        // The global focus ring is a green rectangle, which reads as a
        // validation state on a field you are simply typing in. The label
        // carries a quiet ring instead, matching the trade inputs.
        className="tnum w-full min-w-0 bg-transparent text-[13px] font-bold outline-none placeholder:font-semibold placeholder:text-faint focus:outline-none focus-visible:outline-none"
      />
      {suffix ? (
        <span className="text-[12px] font-bold text-faint">{suffix}</span>
      ) : null}
    </label>
  );

  return (
    <>
      <div className="flex items-center gap-2">
        {field(min, onMin, placeholderMin)}
        <span className="text-[12px] font-bold text-faint">to</span>
        {field(max, onMax, placeholderMax)}
      </div>
      {prefix === "$" && (min !== null || max !== null) ? (
        <p className="mt-1.5 text-[11px] font-semibold text-faint">
          {min !== null ? compactMoney(min) : "Any"} –{" "}
          {max !== null ? compactMoney(max) : "Any"}
        </p>
      ) : null}
    </>
  );
}
