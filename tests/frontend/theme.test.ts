import { describe, expect, it } from "vitest";
import { applyTheme, isTheme, resolveTheme, THEME_STORAGE_KEY } from "../../apps/web/src/theme/theme";
import { terminalTheme } from "../../apps/web/src/terminal-theme";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("深色模式", () => {
  it("已保存主题优先，否则跟随系统，非法值安全回退", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("invalid", true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(THEME_STORAGE_KEY).toBe("ui-theme");
  });

  it("同步根节点 class、data-theme 与 color-scheme", () => {
    const classes = new Set<string>();
    const root = {
      classList: { toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name) },
      dataset: {} as Record<string, string>,
      style: { colorScheme: "" },
    };
    applyTheme("dark", root);
    expect(classes.has("dark")).toBe(true);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    applyTheme("light", root);
    expect(classes.has("dark")).toBe(false);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("Monaco 与 xterm 使用同一主题状态且不硬编码旧配色", () => {
    const editor = read("apps/web/src/components/CodeEditor.tsx");
    expect(editor).toContain('monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs")');
    expect(editor).not.toContain('theme: "vs-dark"');
    const worker = read("apps/web/src/monaco-editor.worker.ts");
    expect(worker).toContain("monaco-editor/esm/vs/language/typescript/ts.worker");
    for (const component of ["TerminalWorkbench.tsx", "ContainerShell.tsx"]) {
      const source = read(`apps/web/src/components/${component}`);
      expect(source).toContain("termRef.current.options.theme = terminalTheme(theme)");
      expect(source).not.toContain('background: "#070b1c"');
    }
    expect(terminalTheme("light").background).toBe("#ffffff");
    expect(terminalTheme("dark").background).toBe("#0a0a0b");
  });

  it("设计令牌同时提供亮色与 .dark 覆盖，首屏脚本避免闪烁", () => {
    const styles = read("apps/web/src/styles.css");
    expect(styles).toContain(":root {");
    expect(styles).toContain(".dark {");
    expect(styles).toContain("--card-shadow:");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    const zIndex = (selector: string) => Number(styles.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s"))?.[1].match(/z-index:\s*(\d+)/)?.[1]);
    expect(zIndex(".app-header")).toBeGreaterThan(zIndex(".workbench"));
    expect(zIndex(".modal")).toBeGreaterThan(zIndex(".app-header"));
    const html = read("apps/web/index.html");
    expect(html).toContain('localStorage.getItem("ui-theme")');
    expect(html).toContain("document.documentElement.classList.toggle");
    expect(html.indexOf("localStorage.getItem")).toBeLessThan(html.indexOf("/src/main.tsx"));
  });
});
