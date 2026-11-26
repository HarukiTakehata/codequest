import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";
import { C2W_RUNTIME_CACHE_MARKER, loadC2wBrowserWorkerAssets } from "../../scripts/c2w-browser-assets.mjs";

const fs = builtin<{
  readFileSync(path: URL, encoding: string): string;
  existsSync(path: URL): boolean;
  readdirSync(path: URL): string[];
}>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("c2w worker 裸模块改写", () => {
  it("构建后脚本把 comlink 与 wasi shim 改成绝对 URL", () => {
    const script = read("scripts/patch-c2w-workers.mjs");
    const helper = read("scripts/c2w-browser-assets.mjs");
    expect(script).toContain("patchC2wWorkerSource");
    expect(helper).toContain("/vendor/comlink/comlink.mjs");
    expect(helper).toContain("/vendor/browser_wasi_shim/index.js");
    expect(helper).toContain("network = false");
    expect(helper).toContain("--net");
    expect(helper).toContain("instrumentC2wWorkerProgress");
    expect(helper).toContain("totalBytes");
    expect(helper).toContain("__C2W_TOTAL_BYTES__");
    expect(helper).toContain("requestedTotal");
    expect(helper).toContain("searchParams.get(\"bytes\")");
    expect(helper).toContain("codequest-c2w-progress");
    expect(helper).toContain("if (!response.ok)");
    expect(helper).toContain('searchParams.get("requestId")');
    expect(helper).toContain('phase: "downloading"');
    expect(helper).toContain('phase: "starting"');
    expect(script).toContain("instrumentC2wWorkerProgress");
    expect(script).toContain("instrumentC2wWorkerCache");
    expect(script).toContain("runtimeBytes");
    expect(script).toContain("runtime/cq-dev-shell.wasm.gz");
    expect(script).not.toContain("runtime/cq-minimal.wasm.gz");
    expect(script).toMatch(/ring-buffer-worker\|vm-worker/);
    expect(script).toContain("instrumentC2wWorkerCache");
    expect(script).not.toContain("DecompressionStream");
    expect(read("packages/runtime-shell/src/container-runtime-cache.ts")).toContain("DecompressionStream");
    expect(read("packages/runtime-shell/src/container-runtime-cache.ts")).toContain("application/wasm");
    expect(script).toContain("node_modules/@webvirt/c2w/node_modules/@bjorn3/browser_wasi_shim/dist");
  });

  it("生成的 VM Worker 先包装进度再包装缓存，ring Worker 不注入缓存", async () => {
    const { vmWorker, ringWorker } = await loadC2wBrowserWorkerAssets(process.cwd(), { totalBytes: 1024 });
    expect(vmWorker).toContain(C2W_RUNTIME_CACHE_MARKER);
    expect(vmWorker).toContain("codequest-c2w-runtime-v1");
    expect(vmWorker).toContain("SHA-256");
    expect(vmWorker).toContain("navigator.locks");
    expect(vmWorker.indexOf("codequest-c2w-progress")).toBeLessThan(vmWorker.indexOf(C2W_RUNTIME_CACHE_MARKER));
    expect(ringWorker).not.toContain(C2W_RUNTIME_CACHE_MARKER);
    expect(ringWorker).not.toContain("codequest-c2w-runtime-v1");
  });

  it("Vite 禁止把 worker 内联为 data URL", () => {
    const config = read("apps/web/vite.config.ts");
    expect(config).toContain("assetsInlineLimit: 0");
  });

  it("loopback spike 改写 worker、使用同版本 shim 与正确 entrypoint", () => {
    const source = read("scripts/spike-loopback.mjs");
    expect(source).toContain("loadC2wBrowserWorkerAssets");
    expect(source).toContain("vendorFiles.get");
    expect(source).toContain('entrypoint: "/bin/sh"');
    expect(source).toContain("return completed");
    expect(source).not.toContain('command: ["/bin/sh", "-c"');
    expect(source).toContain("nc -l -p 8080 127.0.0.1");
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
      if (file.startsWith("vm-worker-")) {
        expect(source).toContain("codequest-c2w-progress");
        expect(source).toContain(C2W_RUNTIME_CACHE_MARKER);
        expect(source).toContain("codequest-c2w-runtime-v1");
        expect(source).toContain("SHA-256");
        expect(source).toContain("DecompressionStream");
        expect(source).toContain("59341603");
        expect(source).not.toContain("__C2W_TOTAL_BYTES__");
        expect(source).not.toContain("--net");
      }
    }
  });
});
