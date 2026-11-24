import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const styles = fs.readFileSync(new URL("../../apps/web/src/styles.css", import.meta.url), "utf8");

describe("表单控件圆角", () => {
  it("单行输入框与下拉框保持胶囊形", () => {
    expect(styles).toMatch(/\.field,[^{}]*\{ border-radius: 999px; \}/);
  });

  it("所有多行 textarea 使用参考项目的 1rem 圆角矩形", () => {
    expect(styles).toContain("textarea, textarea.field, .free-cases textarea, .stdin-row textarea { border-radius: 1rem; resize: vertical; }");
    expect(styles).not.toMatch(/\.free-cases textarea[^{}]*\{[^}]*border-radius: 999px/);
    expect(styles).not.toMatch(/\.stdin-row textarea[^{}]*\{[^}]*border-radius: 999px/);
    expect(styles).not.toMatch(/\.free-cases textarea,\s*\.free-cases select\s*\{[^}]*border-radius:/);
  });
});
