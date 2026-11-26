import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { applyTheme, isTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function savedTheme(): unknown {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialTheme(): Theme {
  if (typeof document !== "undefined" && isTheme(document.documentElement.dataset.theme)) {
    return document.documentElement.dataset.theme;
  }
  return resolveTheme(typeof window === "undefined" ? null : savedTheme(), systemTheme() === "dark");
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const selectTheme = useCallback((next: Theme) => {
    setTheme(next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage may be disabled */ }
  }, []);
  const value = useMemo(() => ({
    theme,
    setTheme: selectTheme,
    toggleTheme: () => selectTheme(theme === "dark" ? "light" : "dark"),
  }), [theme, selectTheme]);

  useEffect(() => {
    applyTheme(theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a0a0b" : "#ffffff");
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => {
      if (!isTheme(savedTheme())) setTheme(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
