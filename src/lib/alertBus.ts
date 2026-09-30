"use client";

import {useEffect, useState, useSyncExternalStore} from "react";

/**
 * The little shared state the desktop alerts need across components that do
 * not share a parent: which list the rail shows, whether a trade is under way,
 * and a pulse that ties a pop-up to the count it belongs to.
 */

// ── The rail's list ────────────────────────────────────────────────────

export const RAIL_LISTS = ["trending", "new", "following", "watchlist"] as const;
export type RailList = (typeof RAIL_LISTS)[number];

let railList: RailList = "trending";
const railListeners = new Set<() => void>();

export function setRailList(next: RailList): void {
  if (railList === next) return;
  railList = next;
  for (const listener of railListeners) listener();
}

/**
 * Kept in memory, like the rail's tab always was: it survives moving between
 * token pages, and a reload starts on Trending.
 */
export function useRailList(): RailList {
  return useSyncExternalStore(
    (listener) => {
      railListeners.add(listener);
      return () => railListeners.delete(listener);
    },
    () => railList,
    () => "trending",
  );
}

// ── A trade under way ──────────────────────────────────────────────────

let tradeBusy = false;
let tradeSheetOpen = false;

/** Set by the ticket while a swap or approval is confirming. */
export function setTradeBusy(busy: boolean): void {
  tradeBusy = busy;
}

/** Set while the phone's buy/sell sheet is open. */
export function setTradeSheetOpen(open: boolean): void {
  tradeSheetOpen = open;
}

/**
 * True while a trade is confirming, the phone's buy/sell sheet is open, or the
 * cursor is in the ticket's amount box. Pop-ups wait for neither; they are dropped, and the counts carry them.
 */
export function tradeInProgress(): boolean {
  if (tradeBusy || tradeSheetOpen) return true;
  if (typeof document === "undefined") return false;
  return Boolean(document.activeElement?.closest("[data-trade-input]"));
}

// ── Pulse ──────────────────────────────────────────────────────────────

export type PulseTarget = "following" | "bell";
const PULSE_EVENT = "hodl:alert-pulse";

export function pulse(target: PulseTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PULSE_EVENT, {detail: target}));
}

/** A key that changes on each pulse, so a count can restart its animation. */
export function usePulse(target: PulseTarget): number {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const onPulse = (event: Event) => {
      if ((event as CustomEvent<PulseTarget>).detail === target) setBeat((n) => n + 1);
    };
    window.addEventListener(PULSE_EVENT, onPulse);
    return () => window.removeEventListener(PULSE_EVENT, onPulse);
  }, [target]);
  return beat;
}

// ── Opening a comment ──────────────────────────────────────────────────

const COMMENT_EVENT = "hodl:open-comment";

/**
 * The hash an asset link carries to open its Comments tab, and scroll to one
 * comment when there is an id.
 */
export function commentHash(commentId?: string | null): string {
  return commentId ? `comment-${commentId}` : "comments";
}

/** Reads `#comments` / `#comment-<id>`; undefined when the hash is neither. */
export function commentTargetFrom(hash: string): string | null | undefined {
  const value = hash.replace(/^#/, "");
  if (value === "comments") return null;
  if (value.startsWith("comment-")) return value.slice("comment-".length) || null;
  return undefined;
}

/**
 * A link that only changes the hash does not remount the page, so the page
 * also listens for this.
 */
export function announceCommentTarget(hash: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMMENT_EVENT, {detail: hash}));
}

export function useCommentTarget(onTarget: (commentId: string | null) => void, resetKey: string): void {
  useEffect(() => {
    const apply = (hash: string) => {
      const target = commentTargetFrom(hash);
      if (target !== undefined) onTarget(target);
    };
    apply(window.location.hash);
    const onEvent = (event: Event) => apply(String((event as CustomEvent<string>).detail ?? ""));
    const onHash = () => apply(window.location.hash);
    window.addEventListener(COMMENT_EVENT, onEvent);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(COMMENT_EVENT, onEvent);
      window.removeEventListener("hashchange", onHash);
    };
  }, [onTarget, resetKey]);
}
