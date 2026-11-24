import type { RunRequest, RunResponse } from "@codequest/judge";
import { toRunResponse, type JavaRuntime } from "./execute";

declare global {
  interface Window {
    JavaWasm: { createRuntime(options: {
      baseUrl: string; onProgress?: (p: { stage: string; detail: string }) => void;
    }): Promise<JavaRuntime> };
  }
}

/** 资产来自 apps/web/public/java（vendored + 校验和固定，见 THIRD-PARTY-NOTICES.md）。 */
export const JAVA_ASSETS_BASE = "/java/";

let runtime: Promise<JavaRuntime> | null = null;
function getRuntime(): Promise<JavaRuntime> {
  if (!runtime) {
    runtime = (async () => {
      if (!window.JavaWasm) await import(/* @vite-ignore */ `${JAVA_ASSETS_BASE}java-wasm.iife.js`);
      return window.JavaWasm.createRuntime({ baseUrl: new URL(JAVA_ASSETS_BASE, location.href).href });
    })();
  }
  return runtime;
}

/** 用户代码在 @live-codes/java-wasm 自建的 Worker 内编译/运行，不进入主线程。 */
export async function runJava(request: RunRequest): Promise<RunResponse> {
  try {
    const engine = await getRuntime();
    const result = await Promise.race([
      engine.run(request.code, { input: request.stdin }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Java 运行超过 ${request.timeoutMs}ms`)), request.timeoutMs),
      ),
    ]);
    return toRunResponse(result);
  } catch (error) {
    return {
      stdout: "",
      stderr: `Java 运行时错误: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 124,
    };
  }
}
