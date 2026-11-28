import type { ScriptWorkerRequest, ScriptWorkerResponse } from "./types";

function failure(message: string): ScriptWorkerResponse {
  return {
    ok: false,
    passed: false,
    score: 0,
    error: message,
    results: [],
    ledgers: [],
    uncovered: {},
  };
}

export interface RunScriptOptions {
  signal?: AbortSignal;
}

/**
 * Main-thread boundary: create/terminate a Worker and transport plain data.
 * This module intentionally has no runtime import of the interpreter or judge.
 */
export function runScript(request: ScriptWorkerRequest, options: RunScriptOptions = {}): Promise<ScriptWorkerResponse> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      resolve(failure(`无法启动脚本 Worker: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    let settled = false;
    const timeoutMs = typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs)
      ? Math.max(1, Math.trunc(request.timeoutMs))
      : 10_000;
    const timer = setTimeout(() => {
      finish(failure(`脚本运行超过 ${timeoutMs}ms，已强制终止`));
    }, timeoutMs);

    const finish = (response: ScriptWorkerResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(response);
    };
    const cancel = () => finish(failure("脚本运行已取消"));

    worker.onmessage = (event: MessageEvent<ScriptWorkerResponse>) => finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(failure(event.message || "脚本 Worker 运行错误"));
    };
    if (options.signal?.aborted) {
      cancel();
      return;
    }
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(failure(`无法发送脚本请求: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}
