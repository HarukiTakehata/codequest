export interface ContainerRuntimeAsset {
  id: string;
  bytes: number;
  sha256?: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const RUNTIME_PATH_PATTERN = /^\/runtime\/cq-dev-([^/]+)\.wasm$/;
let manifestRequest: Promise<readonly ContainerRuntimeAsset[]> | null = null;

function loadManifest(): Promise<readonly ContainerRuntimeAsset[]> {
  if (!manifestRequest) {
    manifestRequest = fetch("/container-environments.json")
      .then((response) => {
        if (!response.ok) throw new Error(`容器清单加载失败 (HTTP ${response.status})`);
        return response.json();
      })
      .then((items: unknown) => {
        if (!Array.isArray(items)) throw new Error("容器清单格式无效");
        return items.filter((item): item is ContainerRuntimeAsset => (
          typeof item === "object" && item !== null
          && typeof (item as ContainerRuntimeAsset).id === "string"
          && Number.isSafeInteger((item as ContainerRuntimeAsset).bytes)
          && (item as ContainerRuntimeAsset).bytes > 0
        ));
      })
      .catch((error) => {
        manifestRequest = null;
        throw error;
      });
  }
  return manifestRequest;
}

/** 将清单中的完整压缩字节校验信息附到运行时 URL；不修改自定义工件 URL。 */
export function applyContainerRuntimeAsset(wasmUrl: string, asset?: ContainerRuntimeAsset): string {
  if (!asset || typeof asset.sha256 !== "string" || !SHA256_PATTERN.test(asset.sha256)) return wasmUrl;
  let url: URL;
  try {
    url = new URL(wasmUrl, globalThis.location?.href ?? "http://localhost/");
  } catch {
    return wasmUrl;
  }
  const pathId = RUNTIME_PATH_PATTERN.exec(url.pathname)?.[1];
  if (!pathId) return wasmUrl;
  const sha256 = asset.sha256.toLowerCase();
  url.searchParams.set("sha256", sha256);
  url.searchParams.set("v", sha256.slice(0, 12));
  if (!url.searchParams.get("env")) url.searchParams.set("env", pathId);
  if (Number.isSafeInteger(asset.bytes) && asset.bytes > 0) url.searchParams.set("bytes", String(asset.bytes));
  return url.toString();
}

/** 所有 Shell 入口共用一次清单请求，默认工件因此也具备完整 SHA-256 缓存校验信息。 */
export async function resolveContainerRuntimeUrl(wasmUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(wasmUrl, globalThis.location?.href ?? "http://localhost/");
  } catch {
    return wasmUrl;
  }
  const id = url.searchParams.get("env") || RUNTIME_PATH_PATTERN.exec(url.pathname)?.[1];
  if (!id || !RUNTIME_PATH_PATTERN.test(url.pathname)) return wasmUrl;
  const suppliedSha = url.searchParams.get("sha256");
  if (suppliedSha && SHA256_PATTERN.test(suppliedSha)) return wasmUrl;
  try {
    const assets = await loadManifest();
    return applyContainerRuntimeAsset(wasmUrl, assets.find((item) => item.id === id));
  } catch {
    return wasmUrl;
  }
}
