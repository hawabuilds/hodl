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
  readStoredTheme,
  systemTheme,
  type Theme,
  writeStoredTheme,
} from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    // No stored choice means the device decides. Defaulting to light put a
    // white screen in front of anyone whose phone is set to dark.
    const stored = readStoredTheme();
    const next = stored ?? systemTheme();
    setThemeState(next);
    applyThemeToDocument(next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeStoredTheme(next);
    applyThemeToDocument(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === "light" ? "dark" : "light";
      writeStoredTheme(next);
      applyThemeToDocument(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
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
