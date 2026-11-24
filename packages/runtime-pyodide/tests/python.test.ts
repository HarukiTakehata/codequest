import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { executePython, type PyodideLike } from "../src/execute";
import type { RunRequest } from "@codequest/judge";

let pyodide: PyodideLike;
beforeAll(async () => { pyodide = (await loadPyodide()) as unknown as PyodideLike; });

const req = (code: string, stdin = ""): RunRequest =>
  ({ lang: "python", code, stdin, timeoutMs: 10_000 });

describe("Python runtime — real Pyodide (design §5.2)", () => {
  it("captures print() output", async () => {
    const result = await executePython(pyodide, req("a, b = 2, 3\nprint('sum =', a + b)"));
    expect(result).toMatchObject({ stdout: "sum = 5\n", stderr: "", exitCode: 0 });
  });

  it("feeds input() from the stdin queue with prompt support", async () => {
    const result = await executePython(pyodide, req(
      "x = input('x? ')\ny = input()\nprint(int(x) + int(y))", "2\n3\n",
    ));
    expect(result.stdout).toBe("x? 5\n");
    expect(result.exitCode).toBe(0);
  });

  it("reports runtime exceptions on stderr with non-zero exit", async () => {
    const result = await executePython(pyodide, req("print('before')\nraise ValueError('boom')"));
    expect(result.stdout).toBe("before\n");
    expect(result.stderr).toContain("ValueError: boom");
    expect(result.exitCode).toBe(1);
  });

  it("supports top-level await via runPythonAsync", async () => {
    const result = await executePython(pyodide, req("import asyncio\nawait asyncio.sleep(0)\nprint('async ok')"));
    expect(result.stdout).toBe("async ok\n");
  });
});
