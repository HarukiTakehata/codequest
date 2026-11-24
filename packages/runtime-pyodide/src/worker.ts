/// <reference lib="webworker" />
import type { RunRequest } from "@codequest/judge";
import { executePython, PYODIDE_CDN, type PyodideLike } from "./execute";

declare function importScripts(url: string): void;
declare global {
  interface Window { loadPyodide: (config: { indexURL: string }) => Promise<PyodideLike> }
}

let instance: Promise<PyodideLike> | null = null;
function pyodide(): Promise<PyodideLike> {
  if (!instance) {
    instance = (async () => {
      if (!("loadPyodide" in self)) {
        importScripts(`${PYODIDE_CDN}pyodide.js`);
      }
      return (self as unknown as Window).loadPyodide({ indexURL: PYODIDE_CDN });
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
