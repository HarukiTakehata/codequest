import { INTERACTIVE_SHELL_PROMPT } from "./container-runtime";

const MAX_CAPTURE_CHARS = 4 * 1024 * 1024;
const encoder = new TextEncoder();

export interface TerminalCommandResult {
  stdout: string;
  exitCode: number;
}

interface ActiveCommand {
  startMarker: string;
  endMarker: string;
  capturing: boolean;
  buffer: string;
  result?: TerminalCommandResult;
  resolve: (result: TerminalCommandResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface InteractiveCommandBridgeOptions {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  onTerminalOutput: (text: string) => void;
  onShellReady?: () => void;
  onShellIdleChange?: (idle: boolean) => void;
  onUserCommandComplete?: () => void;
}

export class ContainerTerminalBusyError extends Error {
  constructor() {
    super("Return to the shell prompt before using the file manager");
    this.name = "ContainerTerminalBusyError";
  }
}

function commandId(): string {
  const value = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? Math.random().toString(36).slice(2);
  return value.padEnd(8, "0").slice(0, 8);
}

function findLineMarker(buffer: string, marker: string): number {
  let from = 0;
  while (from <= buffer.length - marker.length) {
    const at = buffer.indexOf(marker, from);
    if (at < 0) return -1;
    if (at === 0 || buffer[at - 1] === "\n") return at;
    from = at + 1;
  }
  return -1;
}

/**
 * Shares one interactive c2w stdin/stdout with xterm. Every byte is forwarded to the terminal;
 * result markers are only observed so the file manager can read command output and exit codes.
 */
export class InteractiveCommandBridge {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly onTerminalOutput: (text: string) => void;
  private readonly onShellReady?: () => void;
  private readonly onShellIdleChange?: (idle: boolean) => void;
  private readonly onUserCommandComplete?: () => void;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private idle = false;
  private readyReported = false;
  private terminalTail = "";
  private userCommandPending = false;
  private pendingUserWrites = 0;
  private active: ActiveCommand | null = null;

  constructor(options: InteractiveCommandBridgeOptions) {
    this.writer = options.writer;
    this.onTerminalOutput = options.onTerminalOutput;
    this.onShellReady = options.onShellReady;
    this.onShellIdleChange = options.onShellIdleChange;
    this.onUserCommandComplete = options.onUserCommandComplete;
  }

  get isShellIdle(): boolean {
    return this.idle && !this.closed;
  }

  pushStdout(text: string): void {
    if (this.closed || !text) return;
    // Never filter terminal output. Parsing is observational only.
    this.onTerminalOutput(text);
    if (this.active) {
      this.active.buffer += text;
      this.parseCommand();
    }
    this.observePrompt(text);
  }

  pushStderr(text: string): void {
    if (!this.closed && text) {
      this.onTerminalOutput(text);
      this.observePrompt(text);
    }
  }

  sendInput(data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const terminalResponse = typeof data === "string" && /^\x1b\[(?:\d+;\d+R|\?[\d;]+c)$/.test(data);
    if (terminalResponse) {
      if (this.closed) return Promise.reject(new Error("Container session is closed"));
      return this.writer.write(bytes);
    }

    const isCommand = typeof data === "string" && /[\r\n]/.test(data);
    if (isCommand) this.userCommandPending = true;
    this.pendingUserWrites++;
    this.updateIdle(false);
    return this.enqueue(async () => {
      try {
        if (this.closed) throw new Error("Container session is closed");
        this.updateIdle(false);
        await this.writer.write(bytes);
      } finally {
        this.pendingUserWrites = Math.max(0, this.pendingUserWrites - 1);
      }
    });
  }

  run(script: string, timeoutMs = 15_000): Promise<TerminalCommandResult> {
    const oneLine = script.trim().replace(/\r?\n/g, "; ");
    return this.execute((startMarker, endMarker) =>
      `printf '\\n%s\\n' ${startMarker}; ( ${oneLine}; ) 2>&1; printf '\\n%s:%s\\n' ${endMarker} $?\n`,
    timeoutMs);
  }

  /** Multiline input is used for exact text writes; it remains fully echoed and visible. */
  runInput(input: string, timeoutMs = 30_000): Promise<TerminalCommandResult> {
    return this.execute((startMarker, endMarker) =>
      `printf '\\n%s\\n' ${startMarker}\n${input}\nprintf '\\n%s:%s\\n' ${endMarker} $?\n`,
    timeoutMs);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.updateIdle(false);
    this.active?.reject(new Error("Container session is closed"));
    this.active = null;
  }

  private execute(writeCommand: (startMarker: string, endMarker: string) => string, timeoutMs: number): Promise<TerminalCommandResult> {
    return this.enqueue(async () => {
      if (this.closed) throw new Error("Container session is closed");
      if (!this.idle || this.active) throw new ContainerTerminalBusyError();
      const id = commandId();
      const startMarker = `__CQ_${id}__`;
      const endMarker = `__CQ_END_${id}__`;
      return new Promise<TerminalCommandResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.active = null;
          reject(new Error(`Terminal command exceeded ${timeoutMs}ms`));
          void this.writer.write(new Uint8Array([3])).catch(() => undefined);
        }, timeoutMs);
        this.active = { startMarker, endMarker, capturing: false, buffer: "", resolve, reject, timer };
        this.updateIdle(false);
        void this.writer.write(encoder.encode(writeCommand(startMarker, endMarker))).catch((error) => {
          clearTimeout(timer);
          this.active = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    });
  }

  private parseCommand(): void {
    const command = this.active;
    if (!command) return;
    if (command.buffer.length > MAX_CAPTURE_CHARS) {
      clearTimeout(command.timer);
      this.active = null;
      command.reject(new Error("Terminal command output exceeded 4 MiB"));
      return;
    }
    if (!command.capturing) {
      const startAt = findLineMarker(command.buffer, command.startMarker);
      if (startAt < 0) return;
      const startLineEnd = command.buffer.indexOf("\n", startAt + command.startMarker.length);
      if (startLineEnd < 0) return;
      command.capturing = true;
      command.buffer = command.buffer.slice(startLineEnd + 1);
    }
    const endAt = findLineMarker(command.buffer, command.endMarker);
    if (endAt < 0) return;
    const codeEnd = command.buffer.indexOf("\n", endAt + command.endMarker.length);
    if (codeEnd < 0) return;
    const exitCode = Number(command.buffer.slice(endAt + command.endMarker.length + 1, codeEnd).replace(/\r$/, ""));
    if (!Number.isInteger(exitCode)) {
      clearTimeout(command.timer);
      this.active = null;
      command.reject(new Error("Invalid terminal command exit code"));
      return;
    }
    const stdout = command.buffer.slice(0, endAt).replace(/\r?\n$/, "").replace(/\r\n/g, "\n");
    command.result = { stdout, exitCode };
    command.buffer = "";
  }

  private observePrompt(text: string): void {
    this.terminalTail = `${this.terminalTail}${text}`.slice(-256);
    const observableTail = this.terminalTail.replace(/(?:\x1b\[[0-?]*[ -/]*[@-~])+$/g, "");
    const wasIdle = this.idle;
    this.updateIdle(observableTail.endsWith(INTERACTIVE_SHELL_PROMPT));
    if (!this.idle || wasIdle) return;
    if (this.active?.result) {
      clearTimeout(this.active.timer);
      const command = this.active;
      const result = command.result;
      if (!result) return;
      this.active = null;
      command.resolve(result);
    }
    if (!this.readyReported) {
      this.readyReported = true;
      this.onShellReady?.();
    }
    if (!this.active && this.userCommandPending && this.pendingUserWrites === 0) {
      this.userCommandPending = false;
      this.onUserCommandComplete?.();
    }
  }

  private updateIdle(idle: boolean): void {
    if (this.idle === idle) return;
    this.idle = idle;
    this.onShellIdleChange?.(idle);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
