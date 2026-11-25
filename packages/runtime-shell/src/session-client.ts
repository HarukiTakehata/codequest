/** wasi-sh 的交互式会话（字节双工 + Worker 内持久文件系统）。 */
export interface ShellSessionLike {
  onOutput(listener: (bytes: Uint8Array) => void): void;
  write(input: string): void;
  terminate(): void;
  exited: Promise<number>;
}

/** 浏览器内打开常驻 shell 会话；用户命令只在 wasi-sh 的 Worker 内执行（AGENTS.md #4）。 */
export async function openShellSession(files: Record<string, string>): Promise<ShellSessionLike> {
  const { spawn } = await import("wasi-sh");
  const session = spawn({
    files,
    env: { COLUMNS: "80", LINES: "24", LC_ALL: "C" },
  }) as unknown as ShellSessionLike;
  return session;
}

