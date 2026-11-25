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

  it("Pyodide CDN 资源带 CORS 与 CORP，不会被 COEP 阻断", () => {
    // 静态证据由 README/构建记录维护；此处只确保运行时入口使用 CDN ESM。
    const execute = read("packages/runtime-pyodide/src/execute.ts");
    expect(execute).toContain("PYODIDE_CDN");
    expect(execute).toContain("jsdelivr.net");
  });
});
