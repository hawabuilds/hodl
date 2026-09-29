"use client";

import {useSyncExternalStore} from "react";

/**
 * Where the app stops being a phone and becomes a terminal.
 *
 * Tailwind's `lg`, deliberately — every desktop class in the tree uses `lg:`,
 * and a JS breakpoint that disagreed with the CSS one by a pixel would render
 * the desktop tree inside the mobile chrome (or the reverse) in that pixel.
 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * The server cannot know the viewport, so it renders the phone. That is the
 * safer wrong answer: the mobile tree works at any width, while the terminal
 * squeezed into a phone does not.
 */
function serverSnapshot(): boolean {
  return false;
}

/**
 * Whether the terminal layout applies.
 *
 * Only for choosing between whole trees — a discover board versus a feed, a
 * three-pane asset page versus a scrolling one. Anything that is merely a
 * different size belongs in an `lg:` class instead, which needs no JS and
 * cannot flash.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: React uses the
 * server snapshot during hydration, so there is no mismatch warning, and then
 * reads the real value before the browser paints the corrected tree.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
