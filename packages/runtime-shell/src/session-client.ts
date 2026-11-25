/** wasi-sh 的交互式会话（字节双工 + Worker 内持久文件系统）。 */
export interface ShellSessionLike {
  onOutput(listener: (bytes: Uint8Array) => void): void;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  terminate(): void;
  exited: Promise<number>;
}

/** 浏览器内打开常驻 shell 会话；用户命令只在 wasi-sh 的 Worker 内执行（AGENTS.md #4）。 */
export interface ShellSessionOptions {
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export async function openShellSession(
  files: Record<string, string>,
  options: ShellSessionOptions = { cols: 80, rows: 24 },
): Promise<ShellSessionLike> {
  const { spawn } = await import("wasi-sh");
  const session = spawn({
    args: ["busybox", "sh"],
    files,
    env: {
      PS1: "$ ",
      LC_ALL: "C",
      COLUMNS: String(options.cols),
      LINES: String(options.rows),
      ...options.env,
    },
  }) as unknown as ShellSessionLike;
  return session;
}

