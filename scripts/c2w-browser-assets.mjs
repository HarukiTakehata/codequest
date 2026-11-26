#!/usr/bin/env node
// 为前端构建与 loopback spike 提供与浏览器 module worker 兼容的 @webvirt/c2w 资产。
// 上游 worker 使用裸模块名；浏览器没有 import map，必须改写为同源绝对 URL。
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

export const C2W_PROGRESS_CHANNEL = "codequest-c2w-progress";
export const C2W_RUNTIME_CACHE_MARKER = "/* codequest-c2w-runtime-cache */";
const progressMarker = "/* codequest-c2w-progress */";

const progressPreamble = `${progressMarker}
(() => {
  if (typeof BroadcastChannel === "undefined" || typeof ReadableStream === "undefined") return;
  const channel = new BroadcastChannel("${C2W_PROGRESS_CHANNEL}");
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    const isRuntime = url.includes("/runtime/") || url.includes(".wasm");
    let sourceUrl;
    try { sourceUrl = new URL(url, self.location.href); } catch { sourceUrl = null; }
    const environment = sourceUrl?.searchParams.get("env") || "";
    const requestId = sourceUrl?.searchParams.get("requestId") || "";
    let response;
    try {
      response = await nativeFetch(...args);
    } catch (error) {
      if (isRuntime) channel.postMessage({ phase: "error", message: String(error && error.message || error), environment, requestId });
      throw error;
    }
    if (!isRuntime) return response;
    if (!sourceUrl) return response;
    if (!response.ok) {
      channel.postMessage({ phase: "error", environment, requestId, message: ("HTTP " + response.status + " " + response.statusText).trim() });
      return response;
    }
    if (!response.body) { channel.postMessage({ phase: "starting", environment, requestId }); return response; }
    const requestedTotal = Number(sourceUrl.searchParams.get("bytes")) || 0;
    const total = Number(response.headers.get("content-length")) || requestedTotal || __C2W_TOTAL_BYTES__;
    const reader = response.body.getReader();
    let loaded = 0;
    let reported = 0;
    const reportStep = Math.max(256 * 1024, Math.floor(total * 0.01));
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            channel.postMessage({ phase: "starting", environment, requestId });
            return;
          }
          loaded += value.byteLength;
          if (loaded === total || loaded - reported >= reportStep) {
            channel.postMessage({ phase: "downloading", loaded, total, environment, requestId });
            reported = loaded;
          }
          controller.enqueue(value);
        } catch (error) {
          channel.postMessage({ phase: "error", message: String(error && error.message || error), environment, requestId });
          controller.error(error);
        }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
})();
`;

export function instrumentC2wWorkerProgress(source, { totalBytes = 0 } = {}) {
  if (source.includes(progressMarker) || !source.includes("fetchFile")) return source;
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? Math.floor(totalBytes) : 0;
  return progressPreamble.replace("__C2W_TOTAL_BYTES__", String(total)) + source;
}

const cachePreambles = new Map();

async function runtimeCachePreamble(root) {
  if (!cachePreambles.has(root)) {
    cachePreambles.set(root, build({
      absWorkingDir: root,
      stdin: {
        contents: `import { fetchContainerRuntime } from "./packages/runtime-shell/src/container-runtime-cache.ts";
          globalThis.fetch = fetchContainerRuntime;`,
        resolveDir: root,
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: true,
      legalComments: "none",
    }).then((result) => `${C2W_RUNTIME_CACHE_MARKER}\n${result.outputFiles[0].text}\n`));
  }
  return cachePreambles.get(root);
}

/** 在 VM Worker 的真实 fetch 入口加入持久缓存与完整 SHA-256 校验。 */
export async function instrumentC2wWorkerCache(source, { root = process.cwd() } = {}) {
  if (source.includes(C2W_RUNTIME_CACHE_MARKER) || !source.includes("fetchFile")) return source;
  return (await runtimeCachePreamble(root)) + source;
}

export function patchC2wWorkerSource(source, { network = false } = {}) {
  let patched = source
    .replace(/from\s*["']comlink["']/g, 'from"/vendor/comlink/comlink.mjs"')
    .replace(/from\s*["']@bjorn3\/browser_wasi_shim["']/g, 'from"/vendor/browser_wasi_shim/index.js"');
  if (!network && patched.includes('"--net"')) {
    const withoutNetwork = patched.replace(/n\.push\("--net","socket"\),n\.push\("--mac",this\.#e\.net\.macAddress\),/, "");
    if (withoutNetwork === patched) throw new Error("无法禁用 c2w 网络参数：worker 格式已变化");
    patched = withoutNetwork;
  }
  return patched;
}

export async function loadC2wBrowserWorkerAssets(root = process.cwd(), options = {}) {
  const c2wDist = resolve(root, "node_modules/@webvirt/c2w/dist");
  const comlinkDir = resolve(root, "node_modules/comlink/dist/esm");
  // 使用 c2w 自己安装的 shim，避免独立 demo 与 wrapper 的依赖版本漂移。
  const shimDir = resolve(root, "node_modules/@webvirt/c2w/node_modules/@bjorn3/browser_wasi_shim/dist");
  const [vmSource, ringSource, comlink, shimFiles] = await Promise.all([
    readFile(resolve(c2wDist, "vm-worker.js"), "utf8"),
    readFile(resolve(c2wDist, "ring-buffer-worker.js"), "utf8"),
    readFile(resolve(comlinkDir, "comlink.mjs")),
    readdir(shimDir),
  ]);

  const vendorFiles = new Map([["/vendor/comlink/comlink.mjs", comlink]]);
  for (const file of shimFiles.filter((name) => name.endsWith(".js"))) {
    vendorFiles.set(`/vendor/browser_wasi_shim/${file}`, await readFile(resolve(shimDir, file)));
  }

  const patchedVmSource = patchC2wWorkerSource(vmSource, options);
  const cachedVmSource = await instrumentC2wWorkerCache(patchedVmSource, { root });
  return {
    vmWorker: instrumentC2wWorkerProgress(cachedVmSource, options),
    ringWorker: patchC2wWorkerSource(ringSource, options),
    vendorFiles,
  };
}
