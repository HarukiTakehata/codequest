import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("xterm 运行时兼容性", () => {
  it("直接固定已通过生产压缩与 DECRQM 回归的 xterm 版本", () => {
    const web = JSON.parse(read("apps/web/package.json")) as { dependencies: Record<string, string> };
    // 6.0.0 的 requestMode 被当前 Vite/esbuild 压缩成未定义变量，vim 的 DECRQM 会立即使解析器崩溃。
    expect(web.dependencies["@xterm/xterm"]).toBe("5.5.0");
  });

  it("保留覆盖 vim 启动查询与真实编辑的生产浏览器回归入口", () => {
    const root = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const source = read("scripts/test-terminal-vim.mjs");
    expect(root.scripts["test:terminal-vim"]).toBe("node scripts/test-terminal-vim.mjs");
    expect(source).toContain("\\\\033[?2026$p");
    expect(source).toContain("vim cq-vim-test.txt");
    expect(source).toContain("apps/web/dist");
  });
});
