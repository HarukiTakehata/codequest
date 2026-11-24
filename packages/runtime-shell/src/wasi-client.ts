import type { RunRequest, RunResponse } from "@codequest/judge";

/**
 * 设计书 §5.2 的轻量 shell 判题路径：wasi-sh（busybox ash + coreutils 编译为 wasm32-wasi）。
 * 在浏览器内 wasi-sh 自身使用独立 Worker 执行；主线程不执行脚本（AGENTS.md #4）。
 */
export async function runWasiSh(request: RunRequest): Promise<RunResponse> {
  const { run } = await import("wasi-sh");
  const result = await Promise.race([
    run({
      // 与内存教学 shell 保持同一初始 cwd，课程包里的相对路径才可直接用。
      script: `cd /home/student\n${request.code}`,
      stdin: request.stdin,
      files: request.files ?? {},
      env: { LC_ALL: "C" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`shell 运行超过 ${request.timeoutMs}ms`)), request.timeoutMs),
    ),
  ]);
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    exitCode: Number(result.exitCode ?? 0),
    logs: [],
  };
}
