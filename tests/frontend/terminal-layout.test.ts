import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const block = (source: string, selector: string) => source.match(new RegExp(`(?:^|\\n)\\s*${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";

describe("仿真终端布局", () => {
  it("终端机壳无圆角，宿主内容盒让 FitAddon 正确计入内边距", () => {
    const styles = read("apps/web/src/styles.css");
    expect(block(styles, ".terminal-shell-window")).toContain("border-radius: 0");
    expect(block(styles, ".xterm-host")).toContain("box-sizing: content-box");
    expect(block(styles, ".xterm-host")).toContain("padding: 12px 14px");
    expect(block(styles, ".xterm-host")).toContain("overflow: auto");
    expect(block(styles, ".xterm-host .xterm")).toContain("padding: 0");
    expect(styles).toContain("overflow-x: hidden !important");
    expect(styles).toContain("overflow-y: auto; background: transparent;");
  });

  it("两个真实终端入口共享机壳，并把一次测量的网格尺寸传给容器", () => {
    const frame = read("apps/web/src/components/TerminalFrame.tsx");
    expect(frame).toContain("terminal-titlebar");
    expect(frame).toContain("terminal-statusbar");
    expect(frame).toContain("terminal-leds");
    for (const component of ["TerminalWorkbench.tsx", "ContainerShell.tsx"]) {
      const source = read(`apps/web/src/components/${component}`);
      expect(source).toContain("<TerminalFrame");
      expect(source).toContain("const terminalSize = { cols: term.cols, rows: term.rows }");
      expect(source).toContain("fitAddon.fit()");
      expect(source).toContain("terminalSize,");
      expect(source).not.toContain("observeTerminalLayout");
      expect(source).not.toContain('window.addEventListener("resize"');
    }
  });

  it("视口只保留纵向滚动，滚动条为直角硬件风格", () => {
    const styles = read("apps/web/src/styles.css");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("::-webkit-scrollbar { width: 10px; height: 0; }");
    expect(styles).toContain("border-radius: 0; background: hsl(var(--elevated))");
  });
});
