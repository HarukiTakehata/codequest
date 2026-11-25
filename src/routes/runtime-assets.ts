import { Hono } from "hono";

export const runtimeRoutes = new Hono<{ Bindings: { COURSE_PACKS?: R2Bucket } }>();

/**
 * container2wasm 工件（约 98MiB）超过 Workers Assets 的 25MiB 限制，
 * 因此存 R2、经 Worker 以 gzip 流式返回。用户代码不在此执行。
 */
runtimeRoutes.get("/runtime/cq-minimal.wasm", async (c) => {
  const bucket = c.env.COURSE_PACKS;
  if (!bucket) return c.text("R2 bucket not configured", 503);
  const object = await bucket.get("runtime/cq-minimal.wasm.gz");
  if (!object) return c.text("runtime asset not uploaded; run npm run runtime:upload", 404);
  const headers = new Headers({
    "Content-Type": "application/wasm",
    "Content-Encoding": "gzip",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body as ReadableStream, { headers });
});
