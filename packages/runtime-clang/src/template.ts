import type { RunRequest, RunResponse } from "@codequest/judge";

class WasiExit extends Error {
  constructor(readonly code: number) { super(`proc_exit(${code})`); }
}

/**
 * 模板编译模式的极简 WASI shim（设计 §5.2 兜底路径）：
 * 管理员用 Emscripten/wasi-sdk 预编译 `main()`，课程包附带 wasm；
 * 本运行时只提供 fd_read/fd_write/proc_exit，用户代码依然在 Worker 内执行。
 */
export async function runTemplateWasm(
  bytes: Uint8Array,
  stdin: string,
  timeoutMs = 5000,
): Promise<RunResponse> {
  let stdout = "";
  let stderr = "";
  const input = new TextEncoder().encode(stdin);
  let inputOffset = 0;
  let memory: WebAssembly.Memory | null = null;
  const decoder = new TextDecoder();

  const view = (): DataView => {
    if (!memory) throw new Error("wasm 模块未导出 memory");
    return new DataView(memory.buffer);
  };
  const fdWrite = (fd: number, iovs: number, iovsLen: number, nwrittenPtr: number): number => {
    let written = 0;
    for (let i = 0; i < iovsLen; i++) {
      const ptr = view().getUint32(iovs + i * 8, true);
      const len = view().getUint32(iovs + i * 8 + 4, true);
      const chunk = decoder.decode(new Uint8Array(memory!.buffer, ptr, len));
      if (fd === 1) stdout += chunk;
      else if (fd === 2) stderr += chunk;
      written += len;
    }
    view().setUint32(nwrittenPtr, written, true);
    return 0;
  };
  const fdRead = (_fd: number, iovs: number, iovsLen: number, nreadPtr: number): number => {
    let read = 0;
    for (let i = 0; i < iovsLen && inputOffset < input.length; i++) {
      const ptr = view().getUint32(iovs + i * 8, true);
      const len = view().getUint32(iovs + i * 8 + 4, true);
      const count = Math.min(len, input.length - inputOffset);
      new Uint8Array(memory!.buffer, ptr, count).set(input.subarray(inputOffset, inputOffset + count));
      inputOffset += count;
      read += count;
    }
    view().setUint32(nreadPtr, read, true);
    return 0;
  };

  const imports: WebAssembly.Imports = {
    wasi_snapshot_preview1: {
      fd_write: fdWrite,
      fd_read: fdRead,
      proc_exit: (code: number) => { throw new WasiExit(code); },
      environ_sizes_get: (_countPtr: number, _sizePtr: number) => 0,
      environ_get: () => 0,
      args_sizes_get: (_countPtr: number, _sizePtr: number) => 0,
      args_get: () => 0,
      random_get: (ptr: number, len: number) => {
        new Uint8Array(memory!.buffer, ptr, len).fill(0);
        return 0;
      },
      clock_time_get: () => 0,
    },
  };

  let exitCode = 0;
  try {
    const compiled = await WebAssembly.instantiate(bytes as unknown as BufferSource, imports);
    const instance = (compiled as unknown as WebAssembly.WebAssemblyInstantiatedSource).instance;
    const exports = instance.exports as Record<string, unknown>;
    if (exports.memory instanceof WebAssembly.Memory) memory = exports.memory;
    const entry = exports._start ?? exports.main;
    if (typeof entry === "function") {
      await Promise.race([
        (entry as () => unknown)(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("wasm 运行超时")), timeoutMs)),
      ]);
    } else {
      stderr += "wasm 模块缺少 _start/main 导出\n";
    }
  } catch (error) {
    if (error instanceof WasiExit) exitCode = error.code;
    else stderr += `${error instanceof Error ? error.message : String(error)}\n`;
  }
  if (exitCode === 0 && stderr.trim()) exitCode = 1;
  return { stdout, stderr, exitCode, logs: [] };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 由 challenge/judge 配置决定走模板模式还是 wasm-clang 编译模式。 */
export async function executeCpp(request: RunRequest): Promise<RunResponse> {
  const files = request.files ?? {};
  const encoded = files["__template_wasm_base64"];
  if (!encoded) {
    return {
      stdout: "",
      stderr: "模板编译模式缺少 __template_wasm_base64 工件；请确认课程包已附带预编译 wasm 模板。",
      exitCode: 1,
    };
  }
  return runTemplateWasm(base64ToBytes(encoded), request.stdin, request.timeoutMs);
}
