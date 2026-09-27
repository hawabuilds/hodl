"use client";

import {useEffect, type ReactNode} from "react";

import {applyThemeToDocument, type Theme} from "@/lib/theme";

/**
 * Applies the one theme, and keeps saying so.
 *
 * There is nothing to choose any more, so there is no context value worth
 * storing and no state to re-render on. What remains is the hydration step:
 * the boot script in `layout.tsx` sets the document dark before first paint,
 * and this re-asserts it once React owns the DOM, which matters for a session
 * restored from an older cached build that had written `light` onto the root.
 */

const VALUE: ThemeContextValue = {theme: "dark"};

interface ThemeContextValue {
  theme: Theme;
}

export function ThemeProvider({children}: {children: ReactNode}) {
  useEffect(() => {
    applyThemeToDocument();
  }, []);

  return <>{children}</>;
}

/**
 * Kept as a hook rather than a constant so call sites read unchanged, and so
 * reintroducing a choice later is a change in one file rather than thirty.
 */
export function useThemeContext(): ThemeContextValue {
  return VALUE;
}
