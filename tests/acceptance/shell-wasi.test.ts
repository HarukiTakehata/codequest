import { describe, expect, it } from "vitest";
import { judge, type JudgeConfig } from "@codequest/judge";
import { runWasiSh } from "../../packages/runtime-shell/src/wasi-client";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const readJson = <T>(path: string): T => JSON.parse(
  fs.readFileSync(new URL(`../../courses/demo/${path}`, import.meta.url), "utf8"),
) as T;

describe("M4 轻量 shell 判题路径（wasi-sh，设计书 §5.2）", () => {
  it("真实 busybox：grep 提取 Bandit 令牌", async () => {
    const result = await runWasiSh({
      lang: "shell", code: 'grep -o "CQ{[^}]*}" /home/student/secret.txt', stdin: "", timeoutMs: 10_000,
      files: { "/home/student/secret.txt": "decoy\nCQ{bandit-one}\n" },
    });
    expect(result).toMatchObject({ stdout: "CQ{bandit-one}\n", stderr: "", exitCode: 0 });
  });

  it("课程 sh02_script 的参考解通过真实判题器", async () => {
    const challenge = readJson<{ presetFiles: Record<string, string>; judge: string }>(
      "challenges/sh02_script.json",
    );
    const config = readJson<JudgeConfig>(`judges/${challenge.judge}.json`);
    const verdict = await judge((stdin) => runWasiSh({
      lang: "shell", code: "cat words.txt | sort | uniq -c", stdin,
      files: challenge.presetFiles, timeoutMs: 10_000,
    }), config);
    expect(verdict.passed).toBe(true);
    expect(verdict.score).toBe(100);
  });
});
