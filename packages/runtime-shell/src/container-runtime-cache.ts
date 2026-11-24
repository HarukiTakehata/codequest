export const C2W_RUNTIME_CACHE = "codequest-c2w-runtime-v1";
export const C2W_PROGRESS_CHANNEL = "codequest-c2w-progress";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const RUNTIME_PATH_PATTERN = /^\/runtime\/cq-dev-[^/]+\.wasm$/;
const nativeFetch = globalThis.fetch.bind(globalThis);
let progressChannel: BroadcastChannel | undefined;

interface RuntimeUrl {
  url: URL;
  cacheKey: string;
  environment: string;
  requestId: string;
  expectedSha256: string;
  expectedBytes: number;
}

function runtimeUrl(input: Parameters<typeof fetch>[0]): RuntimeUrl | null {
  const rawUrl = input instanceof Request ? input.url : String(input);
  let url: URL;
  try {
    url = new URL(rawUrl, globalThis.location?.href);
  } catch {
    return null;
  }
  if (!RUNTIME_PATH_PATTERN.test(url.pathname)) return null;
  if (globalThis.location && url.origin !== globalThis.location.origin) return null;
  const suppliedSha = url.searchParams.get("sha256") ?? "";
  const expectedSha256 = SHA256_PATTERN.test(suppliedSha) ? suppliedSha.toLowerCase() : "";
  const requestedBytes = Number(url.searchParams.get("bytes"));
  const expectedBytes = Number.isSafeInteger(requestedBytes) && requestedBytes > 0 ? requestedBytes : 0;
  const cacheUrl = new URL(url);
  cacheUrl.search = "";
  cacheUrl.hash = "";
  return {
    url,
    cacheKey: cacheUrl.toString(),
    environment: url.searchParams.get("env") ?? "",
    requestId: url.searchParams.get("requestId") ?? "",
    expectedSha256,
    expectedBytes,
  };
}

export function containerRuntimeCacheKey(wasmUrl: string): string {
  const parsed = runtimeUrl(wasmUrl);
  if (parsed) return parsed.cacheKey;
  const url = new URL(wasmUrl, globalThis.location?.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function reportProgress(phase: "starting" | "error", runtime: RuntimeUrl, message?: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    progressChannel ??= new BroadcastChannel(C2W_PROGRESS_CHANNEL);
    progressChannel.postMessage({
      phase,
      environment: runtime.environment,
      requestId: runtime.requestId,
      ...(message ? { message } : {}),
    });
  } catch { /* 进度上报失败不能影响容器加载 */ }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器无法执行 SHA-256 校验");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isGzip(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return view[0] === 0x1f && view[1] === 0x8b;
}

function wasmHeaders(): Headers {
  return new Headers({ "Content-Type": "application/wasm" });
}

function cachedResponse(bytes: ArrayBuffer): Response {
  // 缓存保存校验过的原始传输字节（运行时通常为 gzip），但不带 Content-Encoding，避免再次自动解压。
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "application/wasm", "Content-Length": String(bytes.byteLength) },
  });
}

function instantiateResponse(bytes: ArrayBuffer): Response {
  if (!isGzip(bytes)) return new Response(bytes, { status: 200, headers: wasmHeaders() });
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器无法解压容器运行时工件");
  const body = new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, { status: 200, headers: wasmHeaders() });
}

function validateBytes(bytes: ArrayBuffer, runtime: RuntimeUrl): void {
  if (runtime.expectedBytes && bytes.byteLength !== runtime.expectedBytes) {
    throw new Error(`容器运行时字节数不符（期望 ${runtime.expectedBytes}，实际 ${bytes.byteLength}）`);
  }
}

async function validateSha256(bytes: ArrayBuffer, runtime: RuntimeUrl): Promise<void> {
  const actual = await sha256Hex(bytes);
  if (actual !== runtime.expectedSha256) {
    throw new Error(`容器运行时 SHA-256 校验失败（期望 ${runtime.expectedSha256}，实际 ${actual}）`);
  }
}

async function openRuntimeCache(): Promise<Cache | null> {
  if (typeof globalThis.caches === "undefined") return null;
  try {
    return await globalThis.caches.open(C2W_RUNTIME_CACHE);
  } catch {
    return null;
  }
}

async function loadRuntime(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  runtime: RuntimeUrl,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const cache = await openRuntimeCache();
  if (cache) {
    let cached: Response | undefined;
    try {
      cached = await cache.match(runtime.cacheKey);
    } catch { /* 缓存读取失败时回退网络 */ }
    if (cached) {
      try {
        const bytes = await cached.arrayBuffer();
        validateBytes(bytes, runtime);
        await validateSha256(bytes, runtime);
        const response = instantiateResponse(bytes);
        reportProgress("starting", runtime);
        return response;
      } catch {
        try { await cache.delete(runtime.cacheKey); } catch { /* 损坏缓存可能已被浏览器清理 */ }
      }
    }
  }

  const response = await fetchImpl(input, init);
  if (!response.ok) return response;
  const bytes = await response.arrayBuffer();
  try {
    validateBytes(bytes, runtime);
    await validateSha256(bytes, runtime);
    const wasmResponse = instantiateResponse(bytes);
    if (cache) {
      try {
        await cache.put(runtime.cacheKey, cachedResponse(bytes));
      } catch { /* 隐私模式或配额不足时仍允许本次容器启动 */ }
    }
    return wasmResponse;
  } catch (error) {
    reportProgress("error", runtime, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * VM Worker 的运行时下载入口：命中缓存先校验，失效后重下；只有校验通过的响应才持久化。
 * 缓存与 SHA 都针对 gzip 原始字节；返回给 WebAssembly 的始终是不带 Content-Encoding 的 WASM。
 * 第三个参数仅用于测试，浏览器全局 fetch 包装调用时使用模块初始化时捕获的 nativeFetch。
 */
export async function fetchContainerRuntime(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  fetchImpl: typeof fetch = nativeFetch,
): Promise<Response> {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const runtime = method.toUpperCase() === "GET" ? runtimeUrl(input) : null;
  if (!runtime) return fetchImpl(input, init);
  if (!runtime.expectedSha256) {
    const response = await fetchImpl(input, init);
    if (!response.ok) return response;
    return instantiateResponse(await response.arrayBuffer());
  }

  const load = () => loadRuntime(input, init, runtime, fetchImpl);
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`codequest-runtime:${runtime.cacheKey}`, load);
  }
  return load();
}
