import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";
import { builtin, SqliteD1 } from "../helpers/sqlite-d1";
import { hashPassword } from "../../src/lib/password";
import { newId } from "../../src/lib/ids";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string; readdirSync(path: URL): string[] }>("node:fs");
const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

async function fixture() {
  const db = new SqliteD1();
  dbs.push(db);
  const root = new URL("../../migrations/", import.meta.url);
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".sql")).sort()) {
    db.sqlite.exec(fs.readFileSync(new URL(file, root), "utf8"));
  }
  const env = { DB: db.asD1(), TOKEN_PEPPER: "test-pepper", ENVIRONMENT: "test" } as Env;
  const app = createApp();
  const call = (path: string, body?: unknown, cookie?: string, method?: string) =>
    app.fetch(new Request(`https://test.local${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  const now = new Date().toISOString();
  const passwordHash = await hashPassword("student-password-123");
  const id = newId("usr");
  db.sqlite.prepare(`INSERT INTO users (id, email, role, status, password_hash, password_updated_at,
    must_change_password, auth_version, created_at) VALUES (?1, ?2, 'member', 'active', ?3, ?4, 0, 1, ?4)`)
    .run(id, "free@example.test", passwordHash, now);
  const login = await call("/api/v1/auth/login", { email: "free@example.test", password: "student-password-123" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  return { db, call, cookie };
}

describe("自由模式草稿（不依赖剧情，登录后按语言云端保存）", () => {
  it("未登录访问被拒绝", async () => {
    const f = await fixture();
    expect((await f.call("/api/v1/freeform")).status).toBe(401);
    expect((await f.call("/api/v1/freeform/javascript")).status).toBe(401);
  });

  it("默认给出四种以上语言模板与样例测试点", async () => {
    const f = await fixture();
    const response = await f.call("/api/v1/freeform", undefined, f.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { templates: Record<string, string> };
    for (const lang of ["javascript", "python", "cpp", "shell", "java"]) {
      expect(body.templates[lang]).toContain(lang === "java" ? "class Main" : "");
    }
  });

  it("保存并重新读取草稿，拒绝非法语言与非法测试点", async () => {
    const f = await fixture();
    const draft = {
      code: "print(42)",
      stdin: "x\n",
      testcases: [{ id: "t1", name: "用例", stdin: "", expected: "42\n", mode: "eol" }],
    };
    expect((await f.call("/api/v1/freeform/python", draft, f.cookie, "PUT")).status).toBe(200);
    const read = await f.call("/api/v1/freeform/python", undefined, f.cookie);
    const body = await read.json() as { draft: { code: string; testcases: { expected: string }[] } };
    expect(body.draft.code).toBe("print(42)");
    expect(body.draft.testcases[0]?.expected).toBe("42\n");

    expect((await f.call("/api/v1/freeform/ruby", draft, f.cookie, "PUT")).status).toBe(400);
    expect((await f.call("/api/v1/freeform/python", { ...draft, testcases: [{ ...draft.testcases[0], mode: "bogus" }] }, f.cookie, "PUT")).status).toBe(400);
  });
});
