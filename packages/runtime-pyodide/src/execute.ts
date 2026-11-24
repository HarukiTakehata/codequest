import type { RunRequest, RunResponse } from "@codequest/judge";

export const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

/** 在用户代码之前注入：patch stdin/stdout/stderr，提供 input()（设计 §5.2）。 */
export const PYTHON_BOOTSTRAP = `
import sys, io, builtins
_cq_lines = __cq_stdin.splitlines()
_cq_idx = 0
def _cq_input(prompt=''):
    global _cq_idx
    sys.stdout.write(str(prompt))
    if _cq_idx >= len(_cq_lines):
        raise EOFError('EOF when reading a line')
    line = _cq_lines[_cq_idx]
    _cq_idx += 1
    return line
builtins.input = _cq_input
class _CqStream(io.TextIOBase):
    def __init__(self):
        self._buf = []
    def write(self, text):
        self._buf.append(str(text))
        if sum(len(part) for part in self._buf) > 1024 * 1024:
            raise RuntimeError('stdout 超过 1MB 输出上限')
        return len(text)
    def flush(self):
        pass
    def getvalue(self):
        return ''.join(self._buf)
_cq_out = _CqStream()
_cq_err = _CqStream()
sys.stdout = _cq_out
sys.stderr = _cq_err
`.trim();

export interface PyodideLike {
  globals: { set(key: string, value: unknown): void };
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
}

/** 运行时内核，接受任意 Pyodide 实例（浏览器 Worker 与 Node 测试共用同一份逻辑）。 */
export async function executePython(
  pyodide: PyodideLike,
  request: RunRequest,
): Promise<RunResponse> {
  pyodide.globals.set("__cq_stdin", request.stdin);
  await pyodide.runPythonAsync(PYTHON_BOOTSTRAP);
  let thrown = "";
  try {
    await pyodide.runPythonAsync(request.code);
  } catch (error) {
    thrown = `${error instanceof Error ? error.message : String(error)}\n`;
  }
  let stdout = "";
  let stderr = "";
  try {
    stdout = String(pyodide.runPython("sys.stdout.getvalue()") ?? "");
    stderr = String(pyodide.runPython("sys.stderr.getvalue()") ?? "");
  } catch {
    stderr += "无法读取 Python 输出缓冲区\n";
  }
  stderr += thrown;
  return { stdout, stderr, exitCode: stderr.trim() ? 1 : 0, logs: [] };
}
