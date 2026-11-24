import { compareOutput } from "./diff";
import type {
  DiffMode,
  JudgeConfig,
  JudgeResult,
  RunResponse,
  TestResult,
} from "./types";

export type CaseRunner = (stdin: string, index: number) => Promise<RunResponse>;

const TIMEOUT_EXIT_CODE = 124;

/**
 * 判题器：只依赖「拿一份 stdout/exitCode 回来」，不接触任何运行时（设计 §3 / §5.3）。
 * 按顺序跑全部测试点，逐点比对，汇总通过率，并给出首个失败点的行级 diff。
 */
export async function judge(
  runCase: CaseRunner,
  config: JudgeConfig,
  timeoutMs = 10_000,
): Promise<JudgeResult> {
  const results: TestResult[] = [];
  for (let index = 0; index < config.cases.length; index++) {
    const test = config.cases[index]!;
    const mode: DiffMode = test.mode ?? "eol";
    let response: RunResponse;
    try {
      response = await Promise.race([
        runCase(test.stdin, index),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), timeoutMs),
        ),
      ]);
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "timeout";
      results.push({
        id: test.id,
        name: test.name,
        passed: false,
        mode,
        expected: test.expected,
        actual: "",
        stderr: isTimeout ? "运行超时" : String(error),
        exitCode: TIMEOUT_EXIT_CODE,
        diff: [],
        reason: isTimeout ? "timeout" : "stderr",
      });
      continue;
    }

    const diff = compareOutput(test.expected, response.stdout, mode, test.tolerance);
    const stderr = response.stderr.trim();
    let reason: TestResult["reason"] = "ok";
    if (stderr && !diff.length) reason = "stderr";
    else if (diff.length) reason = "output";
    if (response.exitCode !== 0 && reason === "ok") reason = "stderr";
    results.push({
      id: test.id,
      name: test.name,
      passed: reason === "ok",
      mode,
      expected: test.expected,
      actual: response.stdout,
      stderr: response.stderr,
      exitCode: response.exitCode,
      diff,
      reason,
    });
  }

  const totalWeight = config.cases.reduce((sum, c) => sum + (c.weight ?? 1), 0) || 1;
  const earned = results.reduce((sum, r, i) => {
    const weight = config.cases[i]!.weight ?? 1;
    return sum + (r.passed ? weight : 0);
  }, 0);
  const firstFailure = results.find((r) => !r.passed) ?? null;
  return {
    passed: results.length > 0 && results.every((r) => r.passed),
    score: Math.round((earned / totalWeight) * 100),
    results,
    firstFailure,
  };
}

/** 供 Worker 侧「校验回放」复用：相同 runCase + 相同配置必须得到相同结论（R11）。 */
export function replayIsConsistent(a: JudgeResult, b: JudgeResult): boolean {
  return a.passed === b.passed && a.score === b.score &&
    a.results.length === b.results.length &&
    a.results.every((r, i) => r.passed === b.results[i]?.passed &&
      r.expected === b.results[i]?.expected &&
      r.actual === b.results[i]?.actual);
}
