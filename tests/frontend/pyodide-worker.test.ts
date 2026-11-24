import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Pyodide Worker 协议一致性", () => {
  it("module worker 不再调用 importScripts（classic-only API）", () => {
    const worker = read("packages/runtime-pyodide/src/worker.ts");
    expect(worker).not.toMatch(/importScripts\s*\(/);
    expect(worker).toContain("pyodide.mjs");
    expect(worker).toContain("PYODIDE_BASE");
  });

  it("client 以 ES module worker 启动，并设置超时终止", () => {
    const client = read("packages/runtime-pyodide/src/client.ts");
    expect(client).toContain('type: "module"');
    expect(client).toContain("terminate()");
  });
});
