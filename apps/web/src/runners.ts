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
      throw new Error("Shell 必须通过常驻容器会话运行，不能创建一次性模拟运行时");
    case "cpp":
      // M3：浏览器内 wasm-clang 真编译；challenge 显式声明 template 时才走模板模式。
      return request.files?.__template_wasm_base64
        ? (await import("@codequest/runtime-clang/src/client")).runCpp(request)
        : (await import("@codequest/runtime-clang/src/online-client")).runCppOnline(request);
    case "java":
      return (await import("@codequest/runtime-java/src/client")).runJava(request);
  }
}
