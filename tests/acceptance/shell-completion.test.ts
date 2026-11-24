import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";
import { FALLBACK_SHELL_APPLETS, shellCompletions } from "../../apps/web/src/shell-completion";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");

describe("M4 验收：shell 补全可用（设计书 §8）", () => {
  it("构建期固化的教学镜像 applet 清单包含 ps/netstat/nc/md5sum", () => {
    const list = fs.readFileSync(new URL("../../apps/web/public/shell-applets.txt", import.meta.url), "utf8")
      .split("\n").map((s) => s.trim()).filter(Boolean);
    expect(list.length).toBeGreaterThan(200);
    for (const tool of ["ps", "pgrep", "netstat", "nc", "stat", "md5sum"]) expect(list).toContain(tool);
  });

  it("按前缀过滤并合并兜底清单", () => {
    expect(shellCompletions([], "gre")).toEqual(["grep"]);
    expect(shellCompletions(["sort", "custom"], "s")).toContain("sort");
    expect(shellCompletions([], "")).toContain("cat");
    expect(FALLBACK_SHELL_APPLETS).toContain("find");
  });
});
