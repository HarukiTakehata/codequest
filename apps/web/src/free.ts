import type { JudgeConfig, TestCase } from "@codequest/judge";

export interface FreeTestCase {
  id: string;
  name: string;
  stdin: string;
  expected: string;
  mode: "exact" | "eol" | "ws" | "regex-line" | "numeric-tol";
}

export const DEFAULT_FREE_TESTCASES: FreeTestCase[] = [
  { id: "t1", name: "样例", stdin: "", expected: "hello\n", mode: "eol" },
];

export function isFactoryFreeSample(test: FreeTestCase): boolean {
  return test.id === "t1" && test.name === "样例" && test.stdin === "" && test.expected === "hello\n" && test.mode === "eol";
}

/** 自由模式自定义测试点 → 统一判题配置（复用同一纯函数判题器）。 */
export function buildFreeJudgeConfig(cases: FreeTestCase[]): JudgeConfig {
  return {
    cases: cases.map((test): TestCase => ({
      id: test.id,
      name: test.name,
      stdin: test.stdin,
      expected: test.expected,
      mode: test.mode,
    })),
  };
}
