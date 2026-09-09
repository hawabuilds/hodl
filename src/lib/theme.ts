export type Theme = "light" | "dark";

export type ThemePreference = Theme | "system";

export type Palette = "terminal" | "legacy";

export const THEME_STORAGE_KEY = "rwa.theme";
export const PALETTE_STORAGE_KEY = "rwa.palette";

/** Status bar / theme-color meta — tracks page base. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#F5F5FF",
  dark: "#0D0F18",
};

export const LEGACY_THEME_COLOR = "#161A40";

export function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

export function isThemePreference(
  value: string | null | undefined,
): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isPalette(value: string | null | undefined): value is Palette {
  return value === "terminal" || value === "legacy";
}

export function readStoredThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** @deprecated Use readStoredThemePreference */
export function readStoredTheme(): Theme | null {
  const pref = readStoredThemePreference();
  if (pref === null || pref === "system") return null;
  return pref;
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

export function writeStoredThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be blocked in private browsing.
  }
}

/** @deprecated Use writeStoredThemePreference */
export function writeStoredTheme(theme: Theme): void {
  writeStoredThemePreference(theme);
}

export function writeStoredPalette(palette: Palette): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // Storage may be blocked in private browsing.
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === "system") return systemTheme();
  return preference;
}

export function applyPaletteToDocument(palette: Palette, theme: Theme): void {
  if (typeof document === "undefined") return;

  if (palette === "legacy" && theme === "dark") {
    document.documentElement.setAttribute("data-palette", "legacy");
  } else {
    document.documentElement.removeAttribute("data-palette");
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const legacy = palette === "legacy" && theme === "dark";
    meta.setAttribute(
      "content",
      legacy ? LEGACY_THEME_COLOR : THEME_COLORS[theme],
    );
  }
}

export function applyThemeToDocument(
  preference: ThemePreference,
  paletteOverride?: Palette,
): Theme {
  if (typeof document === "undefined") return "dark";

  const theme = resolveTheme(preference);

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.style.colorScheme = theme;
  document.documentElement.dataset.theme = theme;

  const palette =
    paletteOverride ??
    readStoredPalette() ??
    (document.documentElement.getAttribute("data-palette") === "legacy"
      ? "legacy"
      : "terminal");
  applyPaletteToDocument(palette, theme);

  return theme;
}
