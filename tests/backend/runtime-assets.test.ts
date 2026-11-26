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
    size: 4,
  } : null;
  const keys: string[] = [];
  const bucket = { get: async (key: string) => { keys.push(key); return object; } } as unknown as R2Bucket;
  const env = { DB: db.asD1(), COURSE_PACKS: bucket, TOKEN_PEPPER: "test" } as Env;
  const app = createApp();
  return {
    fetch: (path: string) => app.fetch(new Request(`https://test.local${path}`), env),
    keys,
  };
}

describe("container2wasm 运行时工件路由（R2）", () => {
  it("未上传工件时返回 404 并提示上传命令", async () => {
    const response = await fixture(false).fetch("/runtime/cq-dev-shell.wasm");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("runtime:upload");
  });

  it("已上传工件以 application/wasm 返回 gzip 原始字节，并带跨源隔离头", async () => {
    const response = await fixture(true).fetch("/runtime/cq-dev-shell.wasm");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect(response.headers.get("etag")).toBe('"test-etag"');
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("不再提供旧 cq-minimal 兼容路由", async () => {
    const app = fixture(true);
    const response = await app.fetch("/runtime/cq-minimal.wasm");
    expect(response.status).toBe(404);
    expect(app.keys).toEqual([]);
  });

  it("按语言读取对应 c2w 工件", async () => {
    const app = fixture(true);
    const response = await app.fetch("/runtime/cq-dev-java.wasm?bytes=123");
    expect(response.status).toBe(200);
    expect(app.keys).toEqual(["runtime/cq-dev-java.wasm.gz"]);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("拒绝未知语言环境", async () => {
    const app = fixture(true);
    const response = await app.fetch("/runtime/cq-dev-rust.wasm");
    expect(response.status).toBe(404);
    expect(app.keys).toEqual([]);
  });

  it("公开访问，不需要登录会话", async () => {
    const response = await fixture(true).fetch("/runtime/cq-dev-shell.wasm");
    expect(response.status).not.toBe(401);
  });
});
