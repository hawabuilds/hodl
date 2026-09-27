/**
 * Appearance. There is one: dark.
 *
 * The app used to follow the system and offer a light palette. It no longer
 * does — hodl is a dark product, the charts, price colours and surface tokens
 * are tuned for it, and a light rendering was a second thing to keep honest
 * for very little in return.
 *
 * The module is kept rather than deleted so the rest of the app can go on
 * asking what the theme is and get a straight answer, and so the boot script
 * and the provider agree on one definition. `Theme` is a single-member union
 * on purpose: anything that tries to set light no longer typechecks.
 */

export type Theme = "dark";

/** Retained so a palette written by an older build can still be read off. */
export const PALETTE_STORAGE_KEY = "rwa.palette";

/**
 * The key the old preference was stored under.
 *
 * Still named here because the boot script clears it: someone who last chose
 * "light" would otherwise carry that choice in localStorage forever, invisible
 * and inert, and the next person to reintroduce a toggle would find accounts
 * already opted out of the only theme that exists.
 */
export const THEME_STORAGE_KEY = "rwa.theme";

export type Palette = "terminal" | "legacy";

/** Status bar / theme-color meta. */
export const THEME_COLOR = "#0D0F18";
export const LEGACY_THEME_COLOR = "#161A40";

export function isPalette(value: string | null | undefined): value is Palette {
  return value === "terminal" || value === "legacy";
}

export function readStoredPalette(): Palette | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredPalette(palette: Palette): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // Storage may be blocked in private browsing.
  }
}

/**
 * The legacy palette is a dark variant, so it survives; it was only ever
 * applied when the theme was already dark.
 */
export function applyPaletteToDocument(palette: Palette): void {
  if (typeof document === "undefined") return;

  if (palette === "legacy") {
    document.documentElement.setAttribute("data-palette", "legacy");
  } else {
    document.documentElement.removeAttribute("data-palette");
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      palette === "legacy" ? LEGACY_THEME_COLOR : THEME_COLOR,
    );
  }
}

export function applyThemeToDocument(paletteOverride?: Palette): Theme {
  if (typeof document === "undefined") return "dark";

  const root = document.documentElement;
  root.classList.add("dark");
  // Removed rather than merely not added: a document that was rendered light
  // by an older cached build must not stay light after this one hydrates.
  root.classList.remove("light");
  root.style.colorScheme = "dark";
  root.dataset.theme = "dark";

  applyPaletteToDocument(paletteOverride ?? readStoredPalette() ?? "terminal");

  return "dark";
}
