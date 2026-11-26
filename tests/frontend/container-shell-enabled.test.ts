import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Container Shell 已启用", () => {
  it("功能开关开启，入口与路由受同一开关控制", () => {
    const flag = read("apps/web/src/features.ts");
    expect(flag).toContain("CONTAINER_SHELL_ENABLED = true");

    const screens = read("apps/web/src/components/Screens.tsx");
    expect(screens).toContain("CONTAINER_SHELL_ENABLED && (");

    const app = read("apps/web/src/App.tsx");
    expect(app).toContain("view === \"container\" && CONTAINER_SHELL_ENABLED");
  });

  it("维护 skill 记录了启用状态与启动修复", () => {
    const skill = read(".opencode/skills/codequest-maintenance/SKILL.md");
    expect(skill).toContain("Container Shell 已启用");
    expect(skill).toContain("assetsInlineLimit");
    expect(skill).toContain("DecompressionStream");
    expect(skill).toContain("DHCP");
    expect(skill).toContain("2.02s");
  });
});
