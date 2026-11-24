import { describe, expect, it } from "vitest";
import { buildInteractiveContainerCommand } from "../../packages/runtime-shell/src/container-runtime";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const readJson = <T>(path: string): T => JSON.parse(
  fs.readFileSync(new URL(`../../courses/demo/${path}`, import.meta.url), "utf8"),
) as T;

interface ExploreChallenge {
  id: string;
  token: string;
  presetFiles: Record<string, string>;
}

const ids = [
  "sh01_explore", "sh02_explore_l2", "sh03_explore_l3", "sh04_explore_l4", "sh05_explore_l5",
];
const levels = ids.map((id) => readJson<ExploreChallenge>(`challenges/${id}.json`));

describe("M4 验收：仿 Bandit 前 5 关课程使用真实容器", () => {
  it("课程脚本包含 5 个探索关与 5 个令牌门", () => {
    const script = fs.readFileSync(new URL("../../courses/demo/start.txt", import.meta.url), "utf8");
    for (const level of levels) expect(script).toContain(`term:${level.id}`);
    for (const level of levels) expect(script).toContain(`token:${level.token}`);
  });

  it("每关预设文件都进入 c2w 容器初始化脚本", () => {
    for (const level of levels) {
      const command = buildInteractiveContainerCommand(level.presetFiles);
      expect(command).toContain("exec /bin/sh");
      for (const path of Object.keys(level.presetFiles)) expect(command).toContain(`base64 -d > '${path}'`);
      expect(Object.values(level.presetFiles).join("\n")).toContain(level.token);
    }
  });
});
