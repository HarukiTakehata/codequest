import type { RunRequest, RunResponse } from "@codequest/judge";

export interface ClangCompiler {
  run(code: string, input: string): Promise<{
    stdout: string; stderr: string; errors: string[];
    exitCode: number | null; compileMs?: number; runMs?: number;
  }>;
  dispose(): void;
}

export type CompilerFactory = (language: "cpp") => Promise<ClangCompiler>;

/** 把在线编译结果适配为统一执行接口（设计书 §5.1 / §6.1）。 */
export function toRunResponse(result: Awaited<ReturnType<ClangCompiler["run"]>>): RunResponse {
  const compileErrors = result.errors ?? [];
  const stderr = [result.stderr, ...compileErrors].filter(Boolean).join("\n");
  return {
    stdout: result.stdout ?? "",
    stderr,
    exitCode: result.exitCode ?? (compileErrors.length ? 1 : 0),
    logs: compileErrors,
  };
}

/** 编译错误 → Monaco 行内诊断（design §6.1 三层兜底的第 3 层）。 */
export function compileDiagnostics(errors: string[]): { line: number; message: string }[] {
  const markers: { line: number; message: string }[] = [];
  for (const error of errors) {
    const match = error.match(/main\.(?:cpp|c):(\d+):\d+:\s*(.*)/);
    if (match) markers.push({ line: Number(match[1]), message: String(match[2]).trim() });
  }
  return markers;
}

export async function runOnline(factory: CompilerFactory, request: RunRequest): Promise<RunResponse> {
  const compiler = await factory("cpp");
  try {
    return toRunResponse(await compiler.run(request.code, request.stdin));
  } finally {
    compiler.dispose();
  }
}
