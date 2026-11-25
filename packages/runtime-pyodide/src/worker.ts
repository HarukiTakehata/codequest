/// <reference lib="webworker" />
import type { RunRequest } from "@codequest/judge";
import { executePython, PYODIDE_BASE, type PyodideLike } from "./execute";

interface PyodideModule {
  loadPyodide(config: { indexURL: string }): Promise<PyodideLike>;
}

let instance: Promise<PyodideLike> | null = null;
function pyodide(): Promise<PyodideLike> {
  if (!instance) {
    instance = (async () => {
      // 本 Worker 是 ES module：不能用 classic worker 的 importScripts；
      // Pyodide 工件已 vendored 到本地 /pyodide/，ESM 入口与 indexURL 都指向本地文件。
      const indexURL = new URL(PYODIDE_BASE, self.location.href).href;
      const module = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`) as PyodideModule;
      return module.loadPyodide({ indexURL });
    })();
  }
  return instance;
}

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  try {
    const response = await executePython(await pyodide(), event.data);
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      stdout: "",
      stderr: `Pyodide 加载失败: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    });
  }
};
