import type { RunRequest } from "@codequest/judge";
import type { ShellRunResponse } from "./shell";

/** Shell 会话运行在独立 Worker 中；切换挑战不复用同一 Worker（MVP）。 */
export function runShell(request: RunRequest): Promise<ShellRunResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        stdout: "", stderr: `运行超过 ${request.timeoutMs}ms`, exitCode: 124,
        files: request.files ?? {}, cwd: "/home/student",
      });
    }, request.timeoutMs + 500);
    worker.onmessage = (event: MessageEvent<ShellRunResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.postMessage(request);
  });
}
