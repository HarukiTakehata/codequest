import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  C2W_RUNTIME_CACHE,
  containerRuntimeCacheKey,
  fetchContainerRuntime,
} from "../../packages/runtime-shell/src/container-runtime-cache";
import {
  applyContainerRuntimeAsset,
  resolveContainerRuntimeUrl,
} from "../../packages/runtime-shell/src/container-runtime-assets";

const origin = "https://codequest.test";
const shellUrl = `${origin}/runtime/cq-dev-shell.wasm`;
const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

let expectedSha: string;
let compressedPayload: Uint8Array<ArrayBuffer>;

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class MemoryCache {
  readonly entries = new Map<string, Response>();
  readonly match = vi.fn(async (key: string) => this.entries.get(key)?.clone());
  readonly put = vi.fn(async (key: string, response: Response) => {
    this.entries.set(key, response.clone());
  });
  readonly delete = vi.fn(async (key: string) => this.entries.delete(key));
}

let cache: MemoryCache;
let open: ReturnType<typeof vi.fn>;

function runtimeUrl(requestId = "one", sha = expectedSha, bytes = compressedPayload.byteLength): string {
  const url = new URL(shellUrl);
  url.searchParams.set("env", "shell");
  url.searchParams.set("requestId", requestId);
  url.searchParams.set("sha256", sha);
  if (bytes) url.searchParams.set("bytes", String(bytes));
  return url.toString();
}

function networkResponse(bytes: Uint8Array<ArrayBuffer> = compressedPayload): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/wasm",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

beforeEach(async () => {
  compressedPayload = await gzip(payload);
  expectedSha = await sha256(compressedPayload);
  cache = new MemoryCache();
  open = vi.fn(async () => cache);
  vi.stubGlobal("caches", { open });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("BroadcastChannel", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("c2w 运行时本地缓存与 SHA-256 校验", () => {
  it("缓存键忽略 requestId 与查询参数，冷启动下载后重启直接复用", async () => {
    const fetchImpl = vi.fn(async () => networkResponse());
    const first = await fetchContainerRuntime(runtimeUrl("first"), undefined, fetchImpl);
    const second = await fetchContainerRuntime(runtimeUrl("second"), undefined, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(C2W_RUNTIME_CACHE);
    expect(containerRuntimeCacheKey(runtimeUrl("first"))).toBe(shellUrl);
    expect(containerRuntimeCacheKey(runtimeUrl("second"))).toBe(shellUrl);
    expect([...cache.entries.keys()]).toEqual([shellUrl]);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(payload);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(payload);
    expect(second.headers.get("Content-Type")).toBe("application/wasm");
    expect(second.headers.get("Content-Encoding")).toBeNull();
    expect(second.headers.get("Content-Length")).toBeNull();
    expect(new Uint8Array(await cache.entries.get(shellUrl)!.arrayBuffer())).toEqual(compressedPayload);
  });

  it("缓存字节损坏时删除旧条目并重新下载", async () => {
    const fetchImpl = vi.fn(async () => networkResponse());
    await fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl);
    cache.entries.set(shellUrl, new Response("corrupted"));

    const response = await fetchContainerRuntime(runtimeUrl("reset"), undefined, fetchImpl);

    expect(cache.delete).toHaveBeenCalledWith(shellUrl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
  });

  it("清单 SHA 变化后不复用旧缓存，而是下载并校验新工件", async () => {
    const fetchImpl = vi.fn(async () => networkResponse());
    await fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl);
    const newPayload = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);
    const newCompressed = await gzip(newPayload);
    const newSha = await sha256(newCompressed);
    fetchImpl.mockImplementation(async () => networkResponse(newCompressed));

    const response = await fetchContainerRuntime(runtimeUrl("new-version", newSha, newCompressed.byteLength), undefined, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(newPayload);
    expect(cache.entries.get(shellUrl)).toBeDefined();
  });

  it("网络响应 SHA 不符时拒绝加载且不写入缓存", async () => {
    const corrupted = compressedPayload.slice();
    corrupted[10] ^= 1;
    const fetchImpl = vi.fn(async () => networkResponse(corrupted));

    await expect(fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl)).rejects.toThrow("SHA-256 校验失败");
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.entries.size).toBe(0);
  });

  it("网络响应字节数不符时拒绝加载且不写入缓存", async () => {
    const fetchImpl = vi.fn(async () => networkResponse());

    await expect(fetchContainerRuntime(runtimeUrl("one", expectedSha, compressedPayload.byteLength + 1), undefined, fetchImpl))
      .rejects.toThrow("字节数不符");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("HTTP 错误不缓存，并把原始响应交给调用方", async () => {
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));

    const response = await fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl);

    expect(response.status).toBe(404);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("缺少完整 SHA 时保持网络加载，不使用无法校验的缓存", async () => {
    const fetchImpl = vi.fn(async () => networkResponse());
    const url = new URL(shellUrl);
    url.searchParams.set("requestId", "one");

    const first = await fetchContainerRuntime(url.toString(), undefined, fetchImpl);
    const second = await fetchContainerRuntime(url.toString(), undefined, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(payload);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(payload);
  });

  it("Cache API 不可用时仍执行完整 SHA 校验", async () => {
    vi.stubGlobal("caches", undefined);
    const fetchImpl = vi.fn(async () => networkResponse());

    const response = await fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl);

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("缓存配额写入失败时降级为本次网络加载", async () => {
    cache.put.mockRejectedValue(new Error("QuotaExceededError"));
    const fetchImpl = vi.fn(async () => networkResponse());

    const response = await fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl);

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
  });

  it("缓存读取失败时回退网络", async () => {
    cache.match.mockRejectedValue(new Error("cache read failed"));
    const fetchImpl = vi.fn(async () => networkResponse());

    const response = await fetchContainerRuntime(runtimeUrl(), undefined, fetchImpl);

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("跨 VM Worker 的首次下载通过 Web Locks 合并", async () => {
    let tail = Promise.resolve();
    const request = vi.fn((_name: string, callback: () => Promise<Response>) => {
      const result = tail.then(callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return networkResponse();
    });

    const first = fetchContainerRuntime(runtimeUrl("worker-a"), undefined, fetchImpl);
    const second = fetchContainerRuntime(runtimeUrl("worker-b"), undefined, fetchImpl);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});

describe("容器运行时清单元数据", () => {
  it("把完整 SHA-256、压缩字节数与环境信息附到默认 Shell URL", () => {
    const resolved = applyContainerRuntimeAsset("/runtime/cq-dev-shell.wasm?requestId=shell-course", {
      id: "shell",
      bytes: 59341603,
      sha256: expectedSha,
    });
    const url = new URL(resolved);

    expect(url.pathname).toBe("/runtime/cq-dev-shell.wasm");
    expect(url.searchParams.get("sha256")).toBe(expectedSha);
    expect(url.searchParams.get("v")).toBe(expectedSha.slice(0, 12));
    expect(url.searchParams.get("bytes")).toBe("59341603");
    expect(url.searchParams.get("env")).toBe("shell");
    expect(url.searchParams.get("requestId")).toBe("shell-course");
  });

  it("自定义非运行时工件 URL 保持原样", () => {
    const custom = "https://cdn.example.test/custom.wasm?requestId=one";
    expect(applyContainerRuntimeAsset(custom, { id: "shell", bytes: 10, sha256: expectedSha })).toBe(custom);
  });

  it("所有默认入口共享一次清单请求，并保留各自 requestId", async () => {
    const fetchManifest = vi.fn(async () => new Response(JSON.stringify([
      { id: "shell", bytes: payload.byteLength, sha256: expectedSha },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchManifest);

    const first = new URL(await resolveContainerRuntimeUrl("/runtime/cq-dev-shell.wasm?requestId=shell-course"));
    const second = new URL(await resolveContainerRuntimeUrl("/runtime/cq-dev-shell.wasm?requestId=shell-free"));

    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(first.searchParams.get("sha256")).toBe(expectedSha);
    expect(second.searchParams.get("sha256")).toBe(expectedSha);
    expect(first.searchParams.get("requestId")).toBe("shell-course");
    expect(second.searchParams.get("requestId")).toBe("shell-free");
  });

  it("调用方已提供完整 SHA 时不再请求清单", async () => {
    const fetchManifest = vi.fn();
    vi.stubGlobal("fetch", fetchManifest);
    const supplied = `${shellUrl}?sha256=${expectedSha}&bytes=${payload.byteLength}`;

    expect(await resolveContainerRuntimeUrl(supplied)).toBe(supplied);
    expect(fetchManifest).not.toHaveBeenCalled();
  });
});
