import type { Lang, RunRequest, RunResponse } from "@codequest/judge";

export interface ExtendedRun extends RunResponse {
  files?: Record<string, string>;
}

/** 主线程仅按语言懒加载对应 Worker，绝不在此执行用户代码（AGENTS.md #4）。 */
export async function runCode(lang: Lang, request: RunRequest): Promise<ExtendedRun> {
  switch (lang) {
    case "javascript":
      return (await import("@codequest/runtime-js/src/client")).runJs(request);
    case "python":
      return (await import("@codequest/runtime-pyodide/src/client")).runPython(request);
    case "shell":
      return (await import("@codequest/runtime-shell/src/client")).runShell(request);
    case "cpp":
      return (await import("@codequest/runtime-clang/src/client")).runCpp(request);
  }
}
