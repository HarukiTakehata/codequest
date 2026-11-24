import type { RunRequest } from "@codequest/judge";
import { createCompiler } from "@live-codes/clang-wasm";
import { toRunResponse } from "./online";

let compiler: Awaited<ReturnType<typeof createCompiler>> | null = null;

self.onmessage = async (event: MessageEvent<{ type: string; request?: RunRequest; baseUrl?: string }>) => {
  const { type, request, baseUrl } = event.data;
  if (type !== "run" || !request || !baseUrl) return;
  try {
    compiler ??= await createCompiler("cpp", { baseUrl });
    const result = await compiler.run(request.code, request.stdin);
    self.postMessage(toRunResponse({
      stdout: result.stdout, stderr: result.stderr, errors: result.errors,
      exitCode: result.exitCode, compileMs: result.compileMs, runMs: result.runMs,
    }));
  } catch (error) {
    self.postMessage({
      stdout: "", stderr: `C/C++ 编译运行失败: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1, logs: [],
    });
  }
};
