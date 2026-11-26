export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_STORAGE_KEY = "ui-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(saved: unknown, systemPrefersDark: boolean): Theme {
  return isTheme(saved) ? saved : systemPrefersDark ? "dark" : "light";
}

interface ThemeRoot {
  classList: { toggle(name: string, force?: boolean): unknown };
  dataset: Record<string, string | undefined>;
  style: { colorScheme: string };
}

export function applyTheme(theme: Theme, root: ThemeRoot = document.documentElement): void {
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
