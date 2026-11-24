import { describe, expect, it } from "vitest";
import { parseJavaDiagnostics, toRunResponse, type JavaRunResult } from "../../packages/runtime-java/src/execute";

describe("M2.5 Java 运行时适配（teavm-javac）", () => {
  it("把 Java 结果映射为统一 RunResponse", () => {
    const result: JavaRunResult = {
      ok: true, output: "hi\n", error: "", stdout: "hi\n", stderr: "",
      exitCode: 0, compileMs: 12, generateMs: 1000, runMs: 1,
    };
    expect(toRunResponse(result)).toEqual({
      stdout: "hi\n", stderr: "", exitCode: 0, logs: [],
    });
  });

  it("把 javac 的行号错误解析为编辑器诊断", () => {
    const stderr = "Main.java:3: error: illegal start of expression\n1 error\n";
    expect(parseJavaDiagnostics(stderr)).toEqual([
      { line: 3, message: "error: illegal start of expression" },
    ]);
    expect(toRunResponse({
      ok: false, output: "", error: stderr, stdout: "", stderr, exitCode: 1,
    })).toMatchObject({ exitCode: 1, logs: ["line 3: error: illegal start of expression"] });
  });
});
