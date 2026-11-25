import { describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";
import { builtin, SqliteD1 } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");

function fixture(withObject: boolean) {
  const db = new SqliteD1();
  db.sqlite.exec(fs.readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
  const object = withObject ? {
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0, 97, 115, 109])); controller.close(); } }),
    httpEtag: '"test-etag"',
  } : null;
  const bucket = { get: async () => object } as unknown as R2Bucket;
  const env = { DB: db.asD1(), COURSE_PACKS: bucket, TOKEN_PEPPER: "test" } as Env;
  const app = createApp();
  return (path: string) => app.fetch(new Request(`https://test.local${path}`), env);
}

describe("container2wasm 运行时工件路由（R2）", () => {
  it("未上传工件时返回 404 并提示上传命令", async () => {
    const response = await fixture(false)("/runtime/cq-minimal.wasm");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("runtime:upload");
  });

  it("已上传工件以 application/wasm + gzip 返回，并带跨源隔离头", async () => {
    const response = await fixture(true)("/runtime/cq-minimal.wasm");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect(response.headers.get("etag")).toBe('"test-etag"');
  });

  it("公开访问，不需要登录会话", async () => {
    const response = await fixture(true)("/runtime/cq-minimal.wasm");
    expect(response.status).not.toBe(401);
  });
});
