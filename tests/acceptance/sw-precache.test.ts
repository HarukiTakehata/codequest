import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{
  readFileSync(path: URL, encoding?: string): string & Uint8Array;
  existsSync(path: URL): boolean;
}>("node:fs");

describe("M4/SW 预缓存：清单覆盖全部运行时资产且校验和一致", () => {
  it("clang asset-receipts.json 的 SHA-256 与 vendored 文件一致", async () => {
    const receipts = JSON.parse(
      fs.readFileSync(new URL("../../apps/web/public/clang/asset-receipts.json", import.meta.url), "utf8"),
    ) as Record<string, { bytes: number; sha256: string }>;
    expect(Object.keys(receipts).length).toBeGreaterThan(3);
    for (const [name, receipt] of Object.entries(receipts)) {
      const path = new URL(`../../apps/web/public/clang/${name}`, import.meta.url);
      expect(fs.existsSync(path), `${name} 缺失`).toBe(true);
      const bytes = new Uint8Array(fs.readFileSync(path));
      const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      expect(hex, `${name} 校验和不一致`).toBe(receipt.sha256);
    }
  });

  it("java manifest 覆盖全部 7 个工件", () => {
    const files = JSON.parse(
      fs.readFileSync(new URL("../../apps/web/public/java/manifest.json", import.meta.url), "utf8"),
    ) as string[];
    expect(files).toHaveLength(7);
    for (const name of files) {
      expect(fs.existsSync(new URL(`../../apps/web/public/java/${name}`, import.meta.url)), `${name} 缺失`).toBe(true);
    }
  });

  it("pyodide 工件已 vendored 且校验和与清单一致", async () => {
    const receipts = JSON.parse(
      fs.readFileSync(new URL("../../apps/web/public/pyodide/asset-receipts.json", import.meta.url), "utf8"),
    ) as Record<string, { bytes: number; sha256: string }>;
    expect(Object.keys(receipts).sort()).toEqual([
      "pyodide-lock.json", "pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide.mjs", "python_stdlib.zip",
    ]);
    for (const [name, receipt] of Object.entries(receipts)) {
      const bytes = new Uint8Array(fs.readFileSync(new URL(`../../apps/web/public/pyodide/${name}`, import.meta.url)));
      expect(bytes.length).toBe(receipt.bytes);
      const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
      expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""))
        .toBe(receipt.sha256);
    }
  });

  it("SW 只缓存运行时资源，不缓存课程包", () => {
    const sw = fs.readFileSync(new URL("../../apps/web/public/sw.js", import.meta.url), "utf8");
    expect(sw).toContain('codequest-runtime-v1');
    expect(sw).toContain('/clang/');
    expect(sw).toContain('/java/');
    expect(sw).toContain('/pyodide/');
    expect(sw).not.toMatch(/api\/v1\/courses|pack/);
  });
});
