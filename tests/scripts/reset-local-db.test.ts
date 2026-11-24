import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("本地数据库重置脚本", () => {
  it("只操作本地 D1，带确认开关且不会调用 --remote", () => {
    const script = read("scripts/reset-local-db.mjs");
    expect(script).toContain("--local");
    expect(script).toContain("--yes");
    expect(script).toContain("v3/d1");
    expect(script).not.toContain("--remote");
  });

  it("npm db:reset 已注册", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:reset"]).toContain("reset-local-db.mjs");
  });
});
