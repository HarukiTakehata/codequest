import { beforeAll, describe, expect, it } from "vitest";
import { judge, type JudgeConfig } from "@codequest/judge";
import { createCompiler } from "@live-codes/clang-wasm";
import { compileDiagnostics, toRunResponse, type ClangCompiler, type CompilerFactory } from "../../packages/runtime-clang/src/online";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const readJson = <T>(path: string): T => JSON.parse(
  fs.readFileSync(new URL(`../../courses/demo/${path}`, import.meta.url), "utf8"),
) as T;

let factory: CompilerFactory;
beforeAll(async () => {
  const compiler = await createCompiler("cpp");
  factory = async () => compiler as unknown as ClangCompiler;
});

async function run(code: string, stdin = ""): Promise<Awaited<ReturnType<ClangCompiler["run"]>>> {
  const compiler = await factory("cpp");
  return compiler.run(code, stdin);
}

describe("M3 验收：wasm-clang 在线编译运行并判题（设计书 §8）", () => {
  it("C 语言入门两题的参考解通过真实编译 + 判题", async () => {
    const cases = [
      { id: "ch01_c_hello", code: '#include <stdio.h>\nint main(void){ puts("hello from C"); return 0; }' },
      {
        id: "ch02_c_sum",
        code: '#include <stdio.h>\nint main(void){ int a,b; if(scanf("%d %d",&a,&b)!=2) return 1; printf("sum=%d\\n",a+b); return 0; }',
      },
    ];
    for (const item of cases) {
      const challenge = readJson<{ judge: string }>(`challenges/${item.id}.json`);
      const config = readJson<JudgeConfig>(`judges/${challenge.judge}.json`);
      const verdict = await judge(async (stdin) => toRunResponse(await run(item.code, stdin)), config);
      expect(verdict.passed, `${item.id}: ${JSON.stringify(verdict.firstFailure)}`).toBe(true);
      expect(verdict.score).toBe(100);
    }
  });

  it("编译错误包含行号并可回填为编辑器诊断", async () => {
    const result = await run("int main(){ int x = ; }");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("1:21");
    expect(result.exitCode).toBeNull();
    expect(compileDiagnostics(result.errors)).toEqual([
      { line: 1, message: "error: expected expression" },
    ]);
    const adapted = toRunResponse(result);
    expect(adapted.exitCode).toBe(1);
    expect(adapted.stderr).toContain("error: expected expression");
  });
});
