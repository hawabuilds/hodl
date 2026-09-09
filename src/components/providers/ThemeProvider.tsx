"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeToDocument,
  readStoredThemePreference,
  resolveTheme,
  type Theme,
  type ThemePreference,
  writeStoredThemePreference,
} from "@/lib/theme";

interface ThemeContextValue {
  /** Resolved appearance (light or dark). */
  theme: Theme;
  /** Stored choice including system follow. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({children}: {children: ReactNode}) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = readStoredThemePreference();
    const nextPreference = stored ?? "system";
    const resolved = applyThemeToDocument(nextPreference);
    setPreferenceState(nextPreference);
    setThemeState(resolved);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
      const currentPref = readStoredThemePreference() ?? "system";
      if (currentPref !== "system") return;
      const resolvedTheme = applyThemeToDocument("system");
      setThemeState(resolvedTheme);
    };
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeStoredThemePreference(next);
    const resolved = applyThemeToDocument(next);
    setThemeState(resolved);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setPreference(next);
  }, [setPreference]);

  const toggleTheme = useCallback(() => {
    const resolved = resolveTheme(preference);
    setPreference(resolved === "light" ? "dark" : "light");
  }, [preference, setPreference]);

  return (
    <ThemeContext.Provider
      value={{theme, preference, setPreference, setTheme, toggleTheme}}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return value;
}
