import type { RunRequest, RunResponse } from "@codequest/judge";

/** 主线程只负责创建/终止 Worker，绝不执行用户代码。 */
export function runJs(request: RunRequest): Promise<RunResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ stdout: "", stderr: `运行超过 ${request.timeoutMs}ms，已强制终止`, exitCode: 124 });
    }, request.timeoutMs + 500);
    worker.onmessage = (event: MessageEvent<RunResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ stdout: "", stderr: event.message || "Worker 运行错误", exitCode: 1 });
    };
    worker.postMessage(request);
  });
}
