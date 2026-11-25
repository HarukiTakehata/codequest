import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{
  readdirSync(path: URL, options?: { withFileTypes?: boolean }): { name: string; isDirectory(): boolean; isFile(): boolean }[];
  readFileSync(path: URL, encoding: string): string;
}>("node:fs");

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const SYMBOL_ARROWS = /[\u2190-\u21FF\u25B6\u25BE]/gu;

function tsxFiles(dir: URL): URL[] {
  const out: URL[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name, dir);
    if (entry.isDirectory()) out.push(...tsxFiles(new URL(entry.name + "/", dir)));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) out.push(url);
  }
  return out;
}

describe("前端不使用 emoji / 文字符号图标", () => {
  it("所有 TSX 组件使用 lucide-react 图标而非 emoji", () => {
    const files = tsxFiles(new URL("../../apps/web/src/", import.meta.url));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(EMOJI)) {
        expect.unreachable(`${file.pathname} 含 emoji: ${match[0]}`);
      }
      for (const match of source.matchAll(SYMBOL_ARROWS)) {
        expect.unreachable(`${file.pathname} 含文字符号图标: ${match[0]}`);
      }
    }
  });

  it("图标统一来自 lucide-react", () => {
    const source = fs.readFileSync(new URL("../../apps/web/src/components/GoalPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain('from "lucide-react"');
    expect(source).toContain("<Check");
  });
});
