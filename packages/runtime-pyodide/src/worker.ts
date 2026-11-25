/// <reference lib="webworker" />
import type { RunRequest } from "@codequest/judge";
import { executePython, PYODIDE_CDN, type PyodideLike } from "./execute";

interface PyodideModule {
  loadPyodide(config: { indexURL: string }): Promise<PyodideLike>;
}

let instance: Promise<PyodideLike> | null = null;
function pyodide(): Promise<PyodideLike> {
  if (!instance) {
    instance = (async () => {
      // 本 Worker 是 ES module：不能用 classic worker 的 importScripts，
      // 改用 Pyodide 官方 ESM 入口（pyodide.mjs），其相对资源由 indexURL 解析。
      const module = await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`) as PyodideModule;
      return module.loadPyodide({ indexURL: PYODIDE_CDN });
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
