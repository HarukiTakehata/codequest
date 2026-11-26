#!/usr/bin/env node
// @webvirt/c2w 的 worker 被 Vite 作为原始资产输出，保留裸模块名 comlink /
// @bjorn3/browser_wasi_shim；module worker 没有 import map，必须改写成可访问的绝对 URL。
import { cpSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { instrumentC2wWorkerCache, instrumentC2wWorkerProgress, patchC2wWorkerSource } from "./c2w-browser-assets.mjs";

const root = process.cwd();
const dist = resolve(root, "apps/web/dist");
if (!existsSync(dist)) {
  console.error("请先构建前端 (npm run build:web)");
  process.exit(1);
}

const vendor = resolve(dist, "vendor");
const runtimeBytes = statSync(resolve(root, "runtime/cq-dev-shell.wasm.gz")).size;
mkdirSync(vendor, { recursive: true });
cpSync(resolve(root, "node_modules/comlink/dist/esm"), resolve(vendor, "comlink"), { recursive: true, force: true });
// 与 @webvirt/c2w 的实际依赖保持一致；根目录可能安装了另一个 shim 版本。
cpSync(resolve(root, "node_modules/@webvirt/c2w/node_modules/@bjorn3/browser_wasi_shim/dist"), resolve(vendor, "browser_wasi_shim"), { recursive: true, force: true });

let patched = 0;
for (const file of readdirSync(resolve(dist, "assets"))) {
  if (!/^(ring-buffer-worker|vm-worker)-.*\.js$/.test(file)) continue;
  const path = resolve(dist, "assets", file);
  let source = readFileSync(path, "utf8");
  const workerPatched = patchC2wWorkerSource(source);
  let changed = workerPatched !== source;
  source = file.startsWith("vm-worker-")
    ? await instrumentC2wWorkerCache(workerPatched, { root })
    : workerPatched;
  if (source !== workerPatched) changed = true;
  source = file.startsWith("vm-worker-")
    ? instrumentC2wWorkerProgress(source, { totalBytes: runtimeBytes })
    : source;
  if (source !== workerPatched) changed = true;
  if (changed) { writeFileSync(path, source); patched++; console.log(`patched ${file}`); }
}
console.log(`c2w workers patched: ${patched}`);
