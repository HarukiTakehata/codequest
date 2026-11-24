import type { RunRequest, RunResponse } from "@codequest/judge";

export function runCpp(request: RunRequest): Promise<RunResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ stdout: "", stderr: `运行超过 ${request.timeoutMs}ms`, exitCode: 124 });
    }, request.timeoutMs + 500);
    worker.onmessage = (event: MessageEvent<RunResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.postMessage(request);
  });
}
