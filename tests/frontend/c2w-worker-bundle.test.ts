import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{
  readFileSync(path: URL, encoding: string): string;
  existsSync(path: URL): boolean;
  readdirSync(path: URL): string[];
}>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("c2w worker 裸模块改写", () => {
  it("构建后脚本把 comlink 与 wasi shim 改成绝对 URL", () => {
    const script = read("scripts/patch-c2w-workers.mjs");
    expect(script).toContain("/vendor/comlink/comlink.mjs");
    expect(script).toContain("/vendor/browser_wasi_shim/index.js");
    expect(script).toMatch(/ring-buffer-worker\|vm-worker/);
    expect(script).toContain("DecompressionStream");
    expect(script).toContain("application/wasm");
  });

  it("Vite 禁止把 worker 内联为 data URL", () => {
    const config = read("apps/web/vite.config.ts");
    expect(config).toContain("assetsInlineLimit: 0");
  });

  it("若已构建，dist 中的 c2w worker 不再保留裸模块名", () => {
    const dist = new URL("../../apps/web/dist/assets/", import.meta.url);
    if (!fs.existsSync(dist)) return;
    const files = fs.readdirSync(dist).filter((f) => /^(ring-buffer-worker|vm-worker)-.*\.js$/.test(f));
    if (!files.length) return;
    for (const file of files) {
      const source = fs.readFileSync(new URL(file, dist), "utf8");
      expect(source).not.toMatch(/from\s*["']comlink["']/);
      expect(source).not.toMatch(/from\s*["']@bjorn3\/browser_wasi_shim["']/);
    }
  });
});
