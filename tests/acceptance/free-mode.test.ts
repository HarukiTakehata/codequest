import { describe, expect, it } from "vitest";
import { judge } from "@codequest/judge";
import { buildFreeJudgeConfig, DEFAULT_FREE_TESTCASES, type FreeTestCase } from "../../apps/web/src/free";
import { executeJs } from "../../packages/runtime-js/src/exec";

describe("自由模式：自定义测试点 → 同一判题器", () => {
  it("默认测试点可直接判题通过", async () => {
    const config = buildFreeJudgeConfig(DEFAULT_FREE_TESTCASES);
    const verdict = await judge((stdin) => executeJs({
      lang: "javascript", code: 'console.log("hello");', stdin, timeoutMs: 5000,
    }), config);
    expect(verdict.passed).toBe(true);
    expect(verdict.score).toBe(100);
  });

  it("用户新增的 regex-line / numeric-tol 模式生效", async () => {
    const cases: FreeTestCase[] = [
      { id: "r1", name: "正则", stdin: "", expected: "answer: \\d+\nx = 1.00000001", mode: "regex-line" },
      { id: "r2", name: "数值", stdin: "", expected: "answer: 42\nx = 1.0", mode: "numeric-tol" },
    ];
    const config = buildFreeJudgeConfig(cases);
    const verdict = await judge((stdin) => executeJs({
      lang: "javascript", code: 'console.log("answer: 42"); console.log("x = 1.00000001");', stdin, timeoutMs: 5000,
    }), config);
    expect(verdict.passed).toBe(true);
    expect(verdict.results.map((r) => r.mode)).toEqual(["regex-line", "numeric-tol"]);
  });
});
