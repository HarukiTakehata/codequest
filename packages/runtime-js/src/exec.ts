import type { RunRequest, RunResponse } from "@codequest/judge";

const MAX_STDOUT_BYTES = 1024 * 1024;

/**
 * JS 运行时内核。只在 Worker 内被调用（AGENTS.md #4），保证死循环不会卡住主线程；
 * 这里保持纯函数式接口，便于 Node 侧直接测试。
 * stdin 以逐行队列模拟 readline()，console.log/error 被劫持收集（设计 §5.2）。
 */
export async function executeJs(request: RunRequest): Promise<RunResponse> {
  const queue = request.stdin.replace(/\r\n?/g, "\n").split("\n");
  if (queue[queue.length - 1] === "") queue.pop();
  let cursor = 0;
  const logs: string[] = [];
  let stdout = "";
  let stderr = "";
  let limitHit = false;

  const collect = (target: "out" | "err", parts: unknown[]): void => {
    const line = parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (part instanceof Error) return `${part.name}: ${part.message}`;
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .join(" ") + "\n";
    if (target === "out") {
      if (stdout.length + line.length > MAX_STDOUT_BYTES) {
        limitHit = true;
        throw new Error("stdout 超过 1MB 输出上限");
      }
      stdout += line;
      logs.push(line);
    } else {
      stderr += line;
    }
  };

  const sandboxConsole = {
    log: (...parts: unknown[]) => collect("out", parts),
    info: (...parts: unknown[]) => collect("out", parts),
    error: (...parts: unknown[]) => collect("err", parts),
    warn: (...parts: unknown[]) => collect("err", parts),
  };
  const readline = (): string | null => (cursor < queue.length ? queue[cursor++]! : null);

  try {
    // 在 Worker 的全局作用域内编译；不使用主线程 eval。
    const compiled = new Function(
      "console", "readline", "stdin", "input",
      `"use strict";\n${request.code}\n`,
    );
    await Promise.resolve(compiled(sandboxConsole, readline, request.stdin, readline));
  } catch (error) {
    stderr += `${error instanceof Error ? error.name : "Error"}: ${
      error instanceof Error ? error.message : String(error)
    }\n`;
  }
  return {
    stdout: limitHit ? stdout + "\n[输出超限，已终止]" : stdout,
    stderr,
    exitCode: stderr.trim() ? 1 : 0,
    logs,
  };
}
