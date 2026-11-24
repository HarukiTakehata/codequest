import type { RunRequest, RunResponse } from "@codequest/judge";

export const CLANG_ASSETS_BASE = "/clang/";

/** 用户 C++ 代码在独立 Worker 内由 wasm-clang 编译并运行（AGENTS.md #4）。 */
export function runCppOnline(request: RunRequest): Promise<RunResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./online-worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ stdout: "", stderr: `C/C++ 编译运行超过 ${request.timeoutMs}ms，已终止`, exitCode: 124 });
    }, request.timeoutMs + 5000);
    worker.onmessage = (event: MessageEvent<RunResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ stdout: "", stderr: event.message || "C/C++ Worker 错误", exitCode: 1 });
    };
    worker.postMessage({
      type: "run", request,
      baseUrl: new URL(CLANG_ASSETS_BASE, location.href).href,
    });
  });
}
