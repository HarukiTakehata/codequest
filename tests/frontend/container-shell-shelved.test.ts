import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Container Shell 暂时搁置", () => {
  it("功能开关默认关闭，代码保留", () => {
    const flag = read("apps/web/src/features.ts");
    expect(flag).toContain("CONTAINER_SHELL_ENABLED = false");

    const screens = read("apps/web/src/components/Screens.tsx");
    expect(screens).toContain("CONTAINER_SHELL_ENABLED && (");

    const app = read("apps/web/src/App.tsx");
    expect(app).toContain("view === \"container\" && CONTAINER_SHELL_ENABLED");
  });

  it("维护 skill 记录了搁置结论与恢复方式", () => {
    const skill = read(".opencode/skills/codequest-maintenance/SKILL.md");
    expect(skill).toContain("Container Shell 暂时搁置");
    expect(skill).toContain("assetsInlineLimit");
    expect(skill).toContain("DecompressionStream");
    expect(skill).toContain("1533ms");
  });
});
