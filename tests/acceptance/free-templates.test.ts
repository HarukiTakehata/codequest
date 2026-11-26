import { describe, expect, it } from "vitest";
import { judge } from "@codequest/judge";
import { FREE_TEMPLATES } from "../../src/routes/freeform";
import { executeJs } from "../../packages/runtime-js/src/exec";
import { executePython, type PyodideLike } from "../../packages/runtime-pyodide/src/execute";
import { createCompiler } from "@live-codes/clang-wasm";
import { toRunResponse, type ClangCompiler } from "../../packages/runtime-clang/src/online";
import { loadPyodide } from "pyodide";

const cases = [{ id: "t1", name: "默认用例", stdin: "", expected: "hello\n", mode: "eol" as const }];

describe("自由模式：默认模板开箱可运行", () => {
  it("JS 模板通过默认测试点", async () => {
    const verdict = await judge((stdin) => executeJs({
      lang: "javascript", code: FREE_TEMPLATES.javascript, stdin, timeoutMs: 5000,
    }), { cases });
    expect(verdict.passed).toBe(true);
  }, 30_000);

  it("Python 模板通过默认测试点（真实 Pyodide）", async () => {
    const pyodide = (await loadPyodide()) as unknown as PyodideLike;
    const verdict = await judge((stdin) => executePython(pyodide, {
      lang: "python", code: FREE_TEMPLATES.python, stdin, timeoutMs: 10_000,
    }), { cases });
    expect(verdict.passed).toBe(true);
  }, 30_000);

  it("C++ 模板通过默认测试点（真实 wasm-clang）", async () => {
    const compiler = await createCompiler("cpp") as unknown as ClangCompiler;
    const verdict = await judge((stdin) => compiler.run(FREE_TEMPLATES.cpp, stdin).then(toRunResponse), { cases });
    expect(verdict.passed).toBe(true);
    compiler.dispose();
  }, 30_000);
});
