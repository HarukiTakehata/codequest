import { Hono, type Context } from "hono";

type Bindings = { COURSE_PACKS?: R2Bucket };
type Env = { Bindings: Bindings };
const LANGUAGE_IDS = new Set(["shell", "cpp", "java", "python", "javascript"]);

export const runtimeRoutes = new Hono<Env>();

function headersFor(size: number, etag?: string | null, cacheControl = "public, max-age=31536000, immutable") {
  const headers = new Headers({
    "Content-Type": "application/wasm",
    "Content-Encoding": "gzip",
    "Content-Length": String(size),
    "Cache-Control": cacheControl,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  if (etag) headers.set("ETag", etag);
  return headers;
}

async function serveRuntimeAsset(c: Context<Env>, key: string) {
  const bucket = c.env.COURSE_PACKS;
  if (!bucket) return c.text("R2 bucket not configured", 503);
  const object = await bucket.get(key);
  if (!object) return c.text(`runtime asset not uploaded; run npm run runtime:upload: ${key}`, 404);
  const cacheControl = key === "runtime/cq-minimal.wasm.gz" ? "no-cache" : undefined;
  return new Response(object.body as ReadableStream, { headers: headersFor(object.size, object.httpEtag, cacheControl) });
}

/** 兼容旧的最小 Shell 工件。 */
runtimeRoutes.get("/runtime/cq-minimal.wasm", (c) => serveRuntimeAsset(c, "runtime/cq-minimal.wasm.gz"));

/** 按语言提供 container2wasm 开发环境工件。 */
for (const language of LANGUAGE_IDS) {
  runtimeRoutes.get(`/runtime/cq-dev-${language}.wasm`, (c) => serveRuntimeAsset(c, `runtime/cq-dev-${language}.wasm.gz`));
}
