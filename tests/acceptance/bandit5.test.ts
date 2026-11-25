import { describe, expect, it } from "vitest";
import { executeShell } from "../../packages/runtime-shell/src/shell";
import { builtin } from "../helpers/sqlite-d1";
import type { RunRequest } from "@codequest/judge";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const readJson = <T>(path: string): T => JSON.parse(
  fs.readFileSync(new URL(`../../courses/demo/${path}`, import.meta.url), "utf8"),
) as T;

interface ExploreChallenge {
  id: string; token: string; presetFiles: Record<string, string>;
}

const ids = [
  "sh01_explore", "sh02_explore_l2", "sh03_explore_l3", "sh04_explore_l4", "sh05_explore_l5",
];
const levels = ids.map((id) => readJson<ExploreChallenge>(`challenges/${id}.json`));
const commands = [
  "cat secret.txt",
  "ls -a levels/l2 && cat levels/l2/.secret",
  "grep 'CQ{' levels/l3/*.txt",
  "find levels/l4 -name 'flag*' && cat /home/student/levels/l4/aa/bb/cc/flag-final.txt",
  "grep 'CQ{l5-' levels/l5/*.txt",
];

describe("M4 验收：仿 Bandit 前 5 关课程可玩（设计书 §8）", () => {
  it("课程脚本包含 5 个探索关与 5 个令牌门", () => {
    const script = fs.readFileSync(new URL("../../courses/demo/start.txt", import.meta.url), "utf8");
    for (const level of levels) expect(script).toContain(`term:${level.id}`);
    for (const level of levels) expect(script).toContain(`token:${level.token}`);
  });

  it("每关的令牌都能用教学 shell 命令找到", () => {
    levels.forEach((level, index) => {
      const request: RunRequest = {
        lang: "shell", code: commands[index]!, stdin: "", files: level.presetFiles, timeoutMs: 5000,
      };
      const result = executeShell(request);
      expect(result.stdout, `${level.id} 未找到令牌`).toContain(level.token);
    });
  });
});
