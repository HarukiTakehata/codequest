import { RunTimeoutError, type Goal, type RunRequest, type RunResponse } from "@codequest/judge";
import { resolveContainerRuntimeUrl } from "./container-runtime-assets";

export interface ContainerStdio {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
}

export interface ContainerReaders {
  stdout?: ReadableStreamDefaultReader<Uint8Array>;
  stderr?: ReadableStreamDefaultReader<Uint8Array>;
}

export interface ContainerSession {
  stdio: ContainerStdio;
  close: (writer?: WritableStreamDefaultWriter<Uint8Array>, readers?: ContainerReaders) => void;
}

export interface AutomatedContainerSession {
  run: (request: RunRequest) => Promise<RunResponse>;
  close: () => void;
}

export interface ContainerSessionOptions {
  wasmUrl?: string;
  automated?: boolean;
  onExit?: (code: number) => void;
  requestId?: string;
  /** 容器 TTY 的固定网格尺寸；WASI 版 c2w 不支持启动后 resize。 */
  terminalSize?: { cols: number; rows: number };
}

const DEFAULT_WASM_URL = "/runtime/cq-dev-shell.wasm";
const MAX_INJECTED_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PROTOCOL_BUFFER_CHARS = 4 * 1024 * 1024;
const CLOSE_GRACE_MS = 750;
export const INTERACTIVE_SHELL_PROMPT = "\x1b[8m__CQ_SHELL_IDLE__\x1b[0m$ ";
const encoder = new TextEncoder();

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function toBase64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function injectedSize(files: Record<string, string>, stdin: string): number {
  return encoder.encode(stdin).length + Object.values(files).reduce((sum, value) => sum + encoder.encode(value).length, 0);
}

function writeFileCommand(path: string, content: string): string[] {
  if (!path.startsWith("/")) throw new Error(`容器文件路径必须是绝对路径: ${path}`);
  const slash = path.lastIndexOf("/");
  const directory = slash <= 0 ? "/" : path.slice(0, slash);
  return [
    `mkdir -p ${shellQuote(directory)}`,
    `printf %s ${shellQuote(toBase64(content))} | /bin/busybox base64 -d > ${shellQuote(path)}`,
  ];
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? Math.random().toString(36).slice(2);
}

function terminalDimension(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function versionedWasmUrl(wasmUrl: string, id: string): string {
  try {
    const url = new URL(wasmUrl, globalThis.location?.href);
    url.searchParams.set("requestId", id);
    return url.toString();
  } catch {
    return `${wasmUrl}${wasmUrl.includes("?") ? "&" : "?"}requestId=${encodeURIComponent(id)}`;
  }
}

export function buildContainerInitialization(files: Record<string, string>, stdin = ""): string[] {
  if (injectedSize(files, stdin) > MAX_INJECTED_BYTES) {
    throw new Error(`Shell 初始文件与 stdin 合计不能超过 ${MAX_INJECTED_BYTES / 1024} KiB`);
  }
  const lines = ["(", "set -eu", "mkdir -p /home/student"];
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(...writeFileCommand(path, content));
  }
  lines.push(
    ...writeFileCommand("/tmp/cq-stdin", stdin),
    ")",
    "init_status=$?",
    '[ "$init_status" -eq 0 ] || exit "$init_status"',
    "cd /home/student || exit 1",
  );
  return lines;
}

export function buildContainerRunBlock(
  script: string,
  stdin: string,
  timeoutMs: number,
  resultMarker: string,
  stderrMarker: string,
  endMarker: string,
  runId = "run",
): string {
  if (injectedSize({}, stdin) + encoder.encode(script).length > MAX_INJECTED_BYTES) {
    throw new Error(`Shell 脚本与 stdin 合计不能超过 ${MAX_INJECTED_BYTES / 1024} KiB`);
  }
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "") || "run";
  const directory = `/tmp/cq-run-${safeRunId}`;
  const stdinPath = `${directory}/stdin`;
  const scriptPath = `${directory}/script.sh`;
  const stdoutPath = `${directory}/stdout`;
  const stderrPath = `${directory}/stderr`;
  const stdoutFifo = `${directory}/stdout.fifo`;
  const stderrFifo = `${directory}/stderr.fifo`;
  const timedOutMarker = `${directory}/timed-out`;
  const timeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000) - 1);
  return [
    `mkdir -p ${shellQuote(directory)} || exit 1`,
    ...writeFileCommand(stdinPath, stdin).map((line) => `${line} || exit 1`),
    ...writeFileCommand(scriptPath, script).map((line) => `${line} || exit 1`),
    `/bin/busybox mkfifo ${shellQuote(stdoutFifo)} ${shellQuote(stderrFifo)} || exit 1`,
    `/bin/busybox head -c ${MAX_OUTPUT_BYTES} < ${shellQuote(stdoutFifo)} > ${shellQuote(stdoutPath)} &`,
    "cq_stdout_pump=$!",
    `/bin/busybox head -c ${MAX_OUTPUT_BYTES} < ${shellQuote(stderrFifo)} > ${shellQuote(stderrPath)} &`,
    "cq_stderr_pump=$!",
    `( sleep ${timeoutSeconds}; : > ${shellQuote(timedOutMarker)} ) >/dev/null 2>&1 &`,
    "cq_watchdog=$!",
    `/bin/busybox timeout -k 1 ${timeoutSeconds}s /bin/sh ${shellQuote(scriptPath)} < ${shellQuote(stdinPath)} > ${shellQuote(stdoutFifo)} 2> ${shellQuote(stderrFifo)}`,
    "code=$?",
    'kill "$cq_watchdog" 2>/dev/null || true',
    'wait "$cq_watchdog" 2>/dev/null || true',
    `if [ -e ${shellQuote(timedOutMarker)} ]; then code=124; fi`,
    '( sleep 1; kill "$cq_stdout_pump" "$cq_stderr_pump" 2>/dev/null ) >/dev/null 2>&1 &',
    "cq_pump_watchdog=$!",
    'wait "$cq_stdout_pump" "$cq_stderr_pump" 2>/dev/null || true',
    'kill "$cq_pump_watchdog" 2>/dev/null || true',
    'wait "$cq_pump_watchdog" 2>/dev/null || true',
    `printf '\\n%s:%s\\n' ${shellQuote(resultMarker)} "$code"`,
    `/bin/busybox base64 ${shellQuote(stdoutPath)}`,
    `printf '\\n%s\\n' ${shellQuote(stderrMarker)}`,
    `/bin/busybox base64 ${shellQuote(stderrPath)}`,
    `printf '\\n%s\\n' ${shellQuote(endMarker)}`,
    `/bin/busybox rm -rf ${shellQuote(directory)}`,
  ].join("\n");
}

/** 在自动会话中探测真实文件状态与命令输出；不另开容器。 */
export function buildContainerGoalCheckScript(goals: Goal[]): string {
  const lines: string[] = [];
  goals.forEach((goal, index) => {
    const check = goal.check;
    if (check.kind !== "file-exists" && check.kind !== "command-stdout") return;
    const marker = `__CQ_GOAL_${index}__`;
    if (check.kind === "file-exists") {
      lines.push(
        `if [ -e ${shellQuote(check.path)} ]; then printf '\\n${marker}=1\\n'; else printf '\\n${marker}=0\\n'; fi`,
      );
      return;
    }
    const output = `/tmp/cq-goal-${index}.stdout`;
    const stderr = `/tmp/cq-goal-${index}.stderr`;
    const expected = `/tmp/cq-goal-${index}.expected`;
    lines.push(
      `( ulimit -f 2048 2>/dev/null || true; /bin/sh -c ${shellQuote(check.command)} > ${shellQuote(output)} 2> ${shellQuote(stderr)} )`,
      ...writeFileCommand(expected, check.expect),
      `if /bin/busybox cmp -s ${shellQuote(output)} ${shellQuote(expected)}; then printf '\\n${marker}=1\\n'; else printf '\\n${marker}=0\\n'; fi`,
      `/bin/busybox rm -f ${shellQuote(output)} ${shellQuote(stderr)} ${shellQuote(expected)}`,
    );
  });
  return lines.join("\n");
}

export function parseContainerGoalChecks(goals: Goal[], stdout: string): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  goals.forEach((goal, index) => {
    if (goal.check.kind !== "file-exists" && goal.check.kind !== "command-stdout") return;
    const match = new RegExp(`(?:^|\\n)__CQ_GOAL_${index}__=([01])(?:\\r?\\n|$)`).exec(stdout);
    results[goal.id] = match?.[1] === "1";
  });
  return results;
}

export function buildInteractiveContainerCommand(
  files: Record<string, string>,
  automated = false,
  terminalSize?: { cols: number; rows: number },
): string {
  const cols = terminalDimension(terminalSize?.cols, 80, 400);
  const rows = terminalDimension(terminalSize?.rows, 25, 200);
  return [
    ...buildContainerInitialization(files),
    // WASI 版 c2w 只能在此处设置一次 TTY 尺寸；启动后再变更 xterm 网格会与容器失配。
    `/bin/busybox stty rows ${rows} cols ${cols}`,
    `export COLUMNS=${cols} LINES=${rows}`,
    ...(automated
      ? ["/bin/busybox stty -echo", "PS1=", "export PS1"]
      : [`PS1=${shellQuote(INTERACTIVE_SHELL_PROMPT)}`, "PS2='> '", "export PS1 PS2"]),
    "exec /bin/sh",
  ].join("\n");
}

async function createC2wContainer(wasmUrl: string, command: string, onExit: (code: number) => void, id: string) {
  const { createContainer } = await import("@webvirt/c2w");
  const resolvedWasmUrl = await resolveContainerRuntimeUrl(wasmUrl);
  return createContainer({
    wasmUrl: versionedWasmUrl(resolvedWasmUrl, id),
    entrypoint: "/bin/sh",
    command: ["-c", command],
    env: { TERM: "xterm", PS1: "$ ", HOME: "/home/student", LC_ALL: "C" },
    onExit,
  });
}

function cancelStream(stream: ReadableStream<Uint8Array> | WritableStream<Uint8Array>): void {
  try {
    if ("cancel" in stream) void stream.cancel().catch(() => undefined);
    else void stream.close().catch(() => undefined);
  } catch { /* 容器退出时流可能已经锁定或关闭 */ }
}

async function cancelReader(reader?: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  if (!reader) return;
  try { await reader.cancel(); } catch { /* 已关闭 */ }
  try { reader.releaseLock(); } catch { /* 已释放 */ }
}

async function abortWriter(writer: WritableStreamDefaultWriter<Uint8Array>): Promise<void> {
  try { await writer.abort(); } catch { /* 已关闭 */ }
  try { writer.releaseLock(); } catch { /* 已释放 */ }
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeSession(
  stdio: ContainerStdio,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  readers: ContainerReaders = {},
): Promise<void> {
  const graceful = (async () => {
    await writer.write(new Uint8Array([3])).catch(() => undefined);
    await writer.write(encoder.encode("exit\n")).catch(() => undefined);
  })();
  await settleWithin(graceful, CLOSE_GRACE_MS);
  await abortWriter(writer);
  await Promise.all([cancelReader(readers.stdout), cancelReader(readers.stderr)]);
  if (!readers.stdout) cancelStream(stdio.stdout);
  if (!readers.stderr) cancelStream(stdio.stderr);
  cancelStream(stdio.stdin);
}

export async function openContainerSession(
  files: Record<string, string> = {},
  options: ContainerSessionOptions = {},
): Promise<ContainerSession> {
  const id = options.requestId ?? requestId();
  let exited = false;
  let closeStarted = false;
  const container = await createC2wContainer(
    options.wasmUrl ?? DEFAULT_WASM_URL,
    buildInteractiveContainerCommand(files, options.automated, options.terminalSize),
    (code) => {
      exited = true;
      options.onExit?.(code);
    },
    id,
  );
  if (exited) {
    cancelStream(container.stdio.stdin);
    cancelStream(container.stdio.stdout);
    cancelStream(container.stdio.stderr);
    throw new Error("容器提前退出");
  }
  return {
    stdio: container.stdio,
    close: (writer, readers) => {
      if (closeStarted) return;
      closeStarted = true;
      let activeWriter = writer;
      if (!activeWriter) {
        try { activeWriter = container.stdio.stdin.getWriter(); }
        catch {
          cancelStream(container.stdio.stdin);
          cancelReader(readers?.stdout);
          cancelReader(readers?.stderr);
          return;
        }
      }
      void closeSession(container.stdio, activeWriter, readers);
    },
  };
}

export async function openAutomatedContainerSession(
  files: Record<string, string> = {},
  options: ContainerSessionOptions = {},
): Promise<AutomatedContainerSession> {
  const id = options.requestId ?? requestId();
  let closed = false;
  let exited = false;
  let rejectActive: ((error: Error) => void) | null = null;
  const container = await createC2wContainer(
    options.wasmUrl ?? DEFAULT_WASM_URL,
    buildInteractiveContainerCommand(files, true),
    (code) => {
      exited = true;
      closed = true;
      rejectActive?.(new Error(`容器提前退出 (${code})`));
    },
    id,
  );
  if (exited) {
    cancelStream(container.stdio.stdin);
    cancelStream(container.stdio.stdout);
    cancelStream(container.stdio.stderr);
    throw new Error("容器提前退出");
  }

  const writer = container.stdio.stdin.getWriter();
  const stdoutReader = container.stdio.stdout.getReader();
  const stderrReader = container.stdio.stderr.getReader();
  let stdoutBuffer = "";
  let shellStderr = "";
  let closeStarted = false;
  let queue: Promise<void> = Promise.resolve();

  const close = () => {
    if (closeStarted) return;
    closeStarted = true;
    closed = true;
    rejectActive?.(new Error("容器会话已关闭"));
    void closeSession(container.stdio, writer, { stdout: stdoutReader, stderr: stderrReader });
  };

  const pump = async (reader: ReadableStreamDefaultReader<Uint8Array>, name: "stdout" | "stderr") => {
    const decoder = new TextDecoder();
    try {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        if (name === "stderr") {
          shellStderr = (shellStderr + decoder.decode(value, { stream: true })).slice(-4000);
          continue;
        }
        stdoutBuffer += decoder.decode(value, { stream: true });
        if (stdoutBuffer.length > MAX_PROTOCOL_BUFFER_CHARS) {
          const error = new Error("容器协议输出超过 4 MiB 上限");
          rejectActive?.(error);
          close();
          break;
        }
      }
    } catch { /* 关闭会话时取消读取 */ }
  };
  void pump(stdoutReader, "stdout");
  void pump(stderrReader, "stderr");

  const execute = (request: RunRequest, timeoutMs: number, resultMarker: string, stderrMarker: string, endMarker: string) =>
    new Promise<RunResponse>((resolve, reject) => {
      if (closed) { reject(new Error("容器会话已关闭")); return; }
      const started = Date.now();
      const executionId = requestId();
      stdoutBuffer = "";
      shellStderr = "";
      let settled = false;
      const finish = (result: RunResponse) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        if (rejectActive === fail) rejectActive = null;
        resolve(result);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        if (rejectActive === fail) rejectActive = null;
        reject(error);
      };
      const parse = () => {
        const resultAt = stdoutBuffer.indexOf(`${resultMarker}:`);
        if (resultAt < 0) return false;
        const codeEnd = stdoutBuffer.indexOf("\n", resultAt);
        const stderrAt = stdoutBuffer.indexOf(stderrMarker, codeEnd + 1);
        const endAt = stdoutBuffer.indexOf(endMarker, stderrAt + stderrMarker.length);
        if (codeEnd < 0 || stderrAt < 0 || endAt < 0) return false;
        try {
          const exitCode = Number(stdoutBuffer.slice(resultAt + resultMarker.length + 1, codeEnd).replace(/\r$/, ""));
          const stdout = fromBase64(stdoutBuffer.slice(codeEnd + 1, stderrAt));
          const stderr = fromBase64(stdoutBuffer.slice(stderrAt + stderrMarker.length, endAt));
          finish({ stdout, stderr, exitCode, logs: [] });
        } catch (error) {
          fail(new Error(`解析容器输出失败: ${error instanceof Error ? error.message : String(error)}\n${stdoutBuffer.slice(-1200)}`));
        }
        return true;
      };
      const timer = setInterval(() => {
        if (parse()) return;
        if (Date.now() - started >= timeoutMs + 1500) {
          void writer.write(new Uint8Array([3])).catch(() => undefined);
          fail(new RunTimeoutError(`Shell 运行超过 ${timeoutMs}ms${shellStderr ? `: ${shellStderr}` : ""}`));
          close();
        }
      }, 20);
      rejectActive = fail;
      void writer.write(encoder.encode(`${buildContainerRunBlock(request.code, request.stdin ?? "", timeoutMs, resultMarker, stderrMarker, endMarker, executionId)}\n`))
        .catch((error) => fail(new Error(`写入容器失败: ${error instanceof Error ? error.message : String(error)}`)));
    });

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    run: (request) => enqueue(async () => {
      const runID = requestId();
      try {
        const response = await execute(request, Math.max(1, request.timeoutMs), `__CQ_RESULT_${runID}__`, `__CQ_STDERR_${runID}__`, `__CQ_END_${runID}__`);
        if (response.exitCode === 124) {
          const detail = response.stderr.trim();
          response.stderr = detail ? `${detail}\nShell 运行超过 ${Math.max(1, request.timeoutMs)}ms` : `Shell 运行超过 ${Math.max(1, request.timeoutMs)}ms`;
        }
        return response;
      } catch (error) {
        if (error instanceof RunTimeoutError) {
          return { stdout: "", stderr: error.message, exitCode: 124, logs: [] };
        }
        throw error;
      }
    }),
    close,
  };
}
