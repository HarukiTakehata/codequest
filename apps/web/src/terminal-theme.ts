import type { Theme } from "./theme/theme";

export function terminalTheme(theme: Theme) {
  const dark = theme === "dark";
  return {
    background: dark ? "#0a0a0b" : "#ffffff",
    foreground: dark ? "#f4f4f5" : "#18181b",
    cursor: dark ? "#f31260" : "#3b82f6",
    selectionBackground: dark ? "rgba(243, 18, 96, 0.28)" : "rgba(59, 130, 246, 0.24)",
    brightYellow: "#fbbf24",
    brightGreen: "#34d399",
    brightCyan: "#22d3ee",
    brightBlue: "#60a5fa",
    brightMagenta: "#e879f9",
    brightRed: "#fb7185",
  };
}
