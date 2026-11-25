import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Container Shell 跨源隔离（SharedArrayBuffer 前提）", () => {
  it("Workers Assets 静态资源带 COOP/COEP 头", () => {
    const headers = read("apps/web/public/_headers");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
  });

  it("本地 vite dev/preview 提供同一组头", () => {
    const config = read("apps/web/vite.config.ts");
    expect(config).toContain('"Cross-Origin-Opener-Policy": "same-origin"');
    expect(config).toContain('"Cross-Origin-Embedder-Policy": "require-corp"');
    expect(config).toContain("preview:");
  });

  it("Vite dev 代理包含 /runtime（c2w wasm 由 Worker/R2 提供）", () => {
    const config = read("apps/web/vite.config.ts");
    expect(config).toContain('"/runtime": { target: "http://localhost:8787"');
  });

  it("Pyodide 工件全部本地化，不被 COEP/CORS 阻断", () => {
    const execute = read("packages/runtime-pyodide/src/execute.ts");
    expect(execute).toContain("PYODIDE_BASE");
    expect(execute).toContain('"/pyodide/"');
    expect(execute).not.toContain("jsdelivr.net");
    const worker = read("packages/runtime-pyodide/src/worker.ts");
    expect(worker).toContain("new URL(PYODIDE_BASE, self.location.href)");
    expect(worker).toContain("pyodide.mjs");
  });
});
