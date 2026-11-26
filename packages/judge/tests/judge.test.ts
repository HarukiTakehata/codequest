import { describe, expect, it } from "vitest";
import { compareOutput, evaluateGoals, judge, replayIsConsistent } from "../src/index";
import type { Goal, JudgeConfig, RunResponse } from "../src/index";

const ok = (stdout: string): RunResponse => ({ stdout, stderr: "", exitCode: 0 });

describe("diff modes (design §5.3)", () => {
  it("exact is byte-sensitive", () => {
    expect(compareOutput("a\n", "a\n", "exact")).toHaveLength(0);
    expect(compareOutput("a\n", "a", "exact")).toHaveLength(1);
  });
  it("eol ignores trailing whitespace and final newline (default)", () => {
    expect(compareOutput("hello \nworld\n\n", "hello\nworld", "eol")).toHaveLength(0);
    expect(compareOutput("1\n2\n", "1\n3\n", "eol")).toEqual([
      { line: 2, expected: "2", actual: "3" },
    ]);
  });
  it("ws collapses internal whitespace", () => {
    expect(compareOutput("a  b\n c ", "a b\nc", "ws")).toHaveLength(0);
  });
  it("regex-line treats expected lines as regexes", () => {
    expect(compareOutput("answer: \\d+\n", "answer: 42\n", "regex-line")).toHaveLength(0);
    expect(compareOutput("answer: \\d+\n", "answer: abc\n", "regex-line")).toHaveLength(1);
  });
  it("numeric-tol uses relative tolerance and keeps non-numeric skeleton", () => {
    expect(compareOutput("x = 1.000", "x = 1.00001", "numeric-tol", 1e-3)).toHaveLength(0);
    expect(compareOutput("x = 1.0", "y = 1.0", "numeric-tol", 1e-3)).toHaveLength(1);
    expect(compareOutput("1 2", "1 2 3", "numeric-tol", 1e-3)).toHaveLength(1);
  });
});

describe("judge pipeline", () => {
  const config: JudgeConfig = {
    cases: [
      { id: "t1", name: "样例", stdin: "1 2", expected: "3\n" },
      { id: "t2", name: "边界", stdin: "0 0", expected: "0\n", weight: 2 },
    ],
  };

  it("runs every case, weights score, and reports first failure with a line diff", async () => {
    const responses: Record<string, RunResponse> = { "1 2": ok("3\n"), "0 0": ok("1\n") };
    const result = await judge((stdin) => Promise.resolve(responses[stdin]!), config);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(33);
    expect(result.firstFailure?.id).toBe("t2");
    expect(result.firstFailure?.diff).toEqual([{ line: 1, expected: "0", actual: "1" }]);
  });

  it("classifies stderr, non-zero exit and timeout separately", async () => {
    const stderrResult = await judge(() => Promise.resolve({ stdout: "3\n", stderr: "boom", exitCode: 1 }), {
      cases: [config.cases[0]!],
    });
    expect(stderrResult.firstFailure?.reason).toBe("stderr");

    const timeoutResult = await judge(() => new Promise<RunResponse>(() => {}), {
      cases: [config.cases[0]!],
    }, 20);
    expect(timeoutResult.firstFailure?.reason).toBe("timeout");

    const runtimeTimeout = await judge(() => Promise.resolve({ stdout: "", stderr: "运行超过 10ms", exitCode: 124 }), {
      cases: [config.cases[0]!],
    });
    expect(runtimeTimeout.firstFailure?.reason).toBe("timeout");

    const runtimeError = await judge(() => Promise.reject(new Error("container exited")), {
      cases: [config.cases[0]!],
    });
    expect(runtimeError.firstFailure?.reason).toBe("stderr");
    expect(runtimeError.firstFailure?.exitCode).toBe(1);
  });

  it("empty config never passes", async () => {
    expect((await judge(() => Promise.resolve(ok("")), { cases: [] })).passed).toBe(false);
  });

  it("replay gives an identical verdict for the same run (anti-cheat foundation)", async () => {
    const run = (stdin: string) => Promise.resolve(ok(stdin === "1 2" ? "3\n" : "0\n"));
    expect(replayIsConsistent(await judge(run, config), await judge(run, config))).toBe(true);
  });
});

describe("goals evaluation (design §6.2)", () => {
  const goals: Goal[] = [
    { id: "main", text: "包含 main 函数", check: { kind: "source-regex", pattern: "int\\s+main" } },
    { id: "no-eval", text: "禁止 eval", check: { kind: "source-not-regex", pattern: "eval\\s*\\(" } },
    { id: "output", text: "输出含 42", check: { kind: "output-contains", value: "42" } },
    { id: "exit", text: "正常退出", check: { kind: "exit-code", value: 0 } },
    { id: "file", text: "存在 /test.sh", check: { kind: "file-exists", path: "/test.sh" } },
    { id: "cmd", text: "检查命令输出一致", check: { kind: "command-stdout", command: "cat /flag", expect: "CQ{ok}" } },
    { id: "tc", text: "全部测试点通过", check: { kind: "testcase", all: true } },
  ];

  it("auto-checks each kind without extra runs", () => {
    const statuses = evaluateGoals(goals, {
      source: "int main() { return 0; }",
      lastRun: ok("42\n"),
      files: { "/test.sh": "#!/bin/sh", "__command__cat /flag": "CQ{ok}" },
      testResults: [
        { id: "t1", name: "t1", passed: true, mode: "eol", expected: "42", actual: "42", stderr: "", exitCode: 0, diff: [], reason: "ok" },
      ],
    });
    expect(statuses.map((s) => [s.id, s.done])).toEqual([
      ["main", true], ["no-eval", true], ["output", true], ["exit", true],
      ["file", true], ["cmd", true], ["tc", true],
    ]);
  });

  it("运行时探测结果优先于初始文件清单", () => {
    const statuses = evaluateGoals(goals, {
      source: "",
      lastRun: null,
      files: { "/test.sh": "stale", "__command__cat /flag": "stale" },
      runtimeGoalResults: { file: false, cmd: true },
      testResults: [],
    });
    expect(statuses.find((status) => status.id === "file")?.done).toBe(false);
    expect(statuses.find((status) => status.id === "cmd")?.done).toBe(true);
  });

  it("does not mark goals done on missing context (except the reverse-source check, which vacuously holds)", () => {
    const statuses = evaluateGoals(goals, { source: "", lastRun: null, files: {}, testResults: [] });
    expect(statuses.filter((s) => !s.done).map((s) => s.id)).toEqual([
      "main", "output", "exit", "file", "cmd", "tc",
    ]);
  });
});
