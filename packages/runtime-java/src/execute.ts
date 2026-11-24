import type { RunResponse } from "@codequest/judge";

/** @live-codes/java-wasm 的公开结果（与 dist/java-wasm.iife.d.ts 一致）。 */
export interface JavaRunResult {
  ok: boolean;
  output: string;
  error: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  compileMs?: number;
  generateMs?: number;
  runMs?: number;
}

export interface JavaRuntime {
  run(source: string, options?: { input?: string; mainClass?: string }): Promise<JavaRunResult>;
  destroy(): void;
}

/** 把 teavm-javac 结果适配到统一 RunResponse（设计书 §5.1）。 */
export function toRunResponse(result: JavaRunResult): RunResponse {
  const stderr = result.stderr || result.error;
  const diagnostics = parseJavaDiagnostics(stderr);
  return {
    stdout: result.stdout || "",
    stderr,
    exitCode: result.exitCode,
    logs: diagnostics.length ? diagnostics.map((d) => `line ${d.line}: ${d.message}`) : [],
  };
}

/** javac 报错形如 Main.java:3: error: ...，回填给 Monaco（M2.5 复用 M3 机制）。 */
export function parseJavaDiagnostics(stderr: string): { line: number; message: string }[] {
  const markers: { line: number; message: string }[] = [];
  for (const match of stderr.matchAll(/(?:^|\n)[^\n:]+:(\d+):\s*([^\n]+)/g)) {
    markers.push({ line: Number(match[1]), message: String(match[2]).trim() });
  }
  return markers;
}
