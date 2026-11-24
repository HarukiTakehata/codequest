import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { evaluateGoals, judge, type Goal, type JudgeConfig, type Lang, type RunResponse } from "@codequest/judge";
import { executeJs } from "../../packages/runtime-js/src/exec";
import { executePython, type PyodideLike } from "../../packages/runtime-pyodide/src/execute";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const root = new URL("../../courses/demo/", import.meta.url);
const read = (path: string) => fs.readFileSync(new URL(path, root), "utf8");
const readJson = <T>(path: string): T => JSON.parse(read(path)) as T;

interface Challenge {
  id: string; lang: Lang; judge?: string; goals?: Goal[];
}
interface JudgeFile extends JudgeConfig { id: string }

const challenges = [
  "ch01_js_hello", "ch02_js_sum", "ch03_js_fizzbuzz",
  "ch02_py_sum", "ch03_py_max", "ch04_py_freq",
].map((id) => readJson<Challenge>(`challenges/${id}.json`));

const solutions: Record<string, string> = {
  ch01_js_hello: 'console.log("hello");',
  ch02_js_sum: "const a = Number(readline()); const b = Number(readline()); console.log(a + b);",
  ch03_js_fizzbuzz:
    "const n = Number(readline()); for (let i=1;i<=n;i++) console.log(i%15===0?'FizzBuzz':i%3===0?'Fizz':i%5===0?'Buzz':i);",
  ch02_py_sum: "a = int(input())\nb = int(input())\nprint(a + b)\n",
  ch03_py_max: "n = int(input())\nnums = [int(input()) for _ in range(n)]\nprint(max(nums))\n",
  ch04_py_freq:
    "n = int(input())\nfreq = {}\nfor _ in range(n):\n    w = input().strip()\n    freq[w] = freq.get(w, 0) + 1\nfor w in sorted(freq):\n    print(w, freq[w])\n",
};

let pyodide: PyodideLike;
beforeAll(async () => { pyodide = (await loadPyodide()) as unknown as PyodideLike; });

async function run(lang: Lang, code: string, stdin: string): Promise<RunResponse> {
  const request = { lang, code, stdin, timeoutMs: 10_000 };
  return lang === "python" ? executePython(pyodide, request) : executeJs(request);
}

describe("M2 验收：Python/JS 各 3 题（设计书 §8）", () => {
  it("课程包含各 3 题且每题都有可解析的 judge 配置", () => {
    const js = challenges.filter((c) => c.lang === "javascript");
    const py = challenges.filter((c) => c.lang === "python");
    expect(js).toHaveLength(3);
    expect(py).toHaveLength(3);
    for (const challenge of challenges) {
      expect(challenge.judge, `${challenge.id} 缺少 judge`).toBeTruthy();
      const config = readJson<JudgeFile>(`judges/${challenge.judge}.json`);
      expect(config.id).toBe(challenge.judge);
      expect(config.cases.length).toBeGreaterThanOrEqual(2);
    }
    const script = read("start.txt");
    for (const challenge of challenges) expect(script).toContain(`code:${challenge.id}`);
  });

  it("6 道题的参考解全部通过真实运行时 + 判题器（加权分 100）", async () => {
    for (const challenge of challenges) {
      const config = readJson<JudgeFile>(`judges/${challenge.judge}.json`);
      const verdict = await judge(
        (stdin) => run(challenge.lang, solutions[challenge.id]!, stdin),
        config,
      );
      expect(verdict.passed, `${challenge.id} 未通过: ${JSON.stringify(verdict.firstFailure)}`).toBe(true);
      expect(verdict.score).toBe(100);
    }
  });

  it("错误解会被拒绝并给出首个失败点的行级 diff", async () => {
    const config = readJson<JudgeFile>("judges/j_js_sum.json");
    const verdict = await judge((stdin) => run("javascript", 'console.log("wrong");', stdin), config);
    expect(verdict.passed).toBe(false);
    expect(verdict.firstFailure?.reason).toBe("output");
    expect(verdict.firstFailure?.diff[0]).toMatchObject({ line: 1, expected: "5", actual: "wrong" });
  });

  it("goals 的 source-regex / output-contains 由真实运行自动勾选", async () => {
    const challenge = challenges.find((c) => c.id === "ch01_js_hello")!;
    const config = readJson<JudgeFile>("judges/j_js_hello.json");
    const verdict = await judge((stdin) => run("javascript", solutions.ch01_js_hello!, stdin), config);
    const lastRun = await run("javascript", solutions.ch01_js_hello!, "");
    const statuses = evaluateGoals(challenge.goals ?? [], {
      source: solutions.ch01_js_hello!, lastRun, files: {}, testResults: verdict.results,
    });
    expect(statuses.every((s) => s.done)).toBe(true);
  });
});
