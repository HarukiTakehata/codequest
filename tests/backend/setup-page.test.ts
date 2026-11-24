import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import { applyAllMigrations, SqliteD1 } from "../helpers/sqlite-d1";
import type { Env } from "../../src/types";
import { readFileSync } from "node:fs";

const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

async function fixture() {
  const db = new SqliteD1();
  dbs.push(db);
  applyAllMigrations(db);
  const env = { DB: db.asD1(), TOKEN_PEPPER: "test-pepper", ENVIRONMENT: "test" } as Env;
  const app = createApp();
  const call = (path: string, body?: unknown, cookie?: string, method?: string) =>
    app.fetch(new Request(`https://test.local${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  return { db, env, call };
}

describe("实例初始化页面（设计书 §7.1 首次启动）", () => {
  it("新实例根路径 302 跳转到 /setup，status 报告 needs_setup", async () => {
    const f = await fixture();
    const root = await f.call("/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/setup");
    const status = await (await f.call("/api/v1/setup/status")).json() as { needs_setup: boolean };
    expect(status.needs_setup).toBe(true);
  });

  it("四步向导可一次性创建管理员与首个课程包，之后根路径不再跳转", async () => {
    const f = await fixture();
    const pack = JSON.parse(readFileSync(new URL("../../courses/demo/course.json", import.meta.url), "utf8"));
    const setupBody = {
      instance_name: "示例实例",
      admin: { username: "owner", email: "owner@example.test", password: "owner-password-123", display_name: "OWNER" },
      course_pack: {
        "course.json": JSON.stringify({ ...pack, id: "init-course", slug: "init-course" }),
        "start.txt": "say:导师:欢迎;end;",
      },
    };
    const response = await f.call("/api/v1/setup", setupBody);
    expect(response.status).toBe(201);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(1);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(1);

    const status = await (await f.call("/api/v1/setup/status")).json() as { needs_setup: boolean; instance_name: string };
    expect(status).toMatchObject({ needs_setup: false, instance_name: "示例实例" });
    const root = await f.call("/");
    expect(root.status).not.toBe(302);
  });

  it("超限课程包初始化返回 413 且不写库，与管理上传使用同一错误", async () => {
    const f = await fixture();
    const response = await f.call("/api/v1/setup", {
      instance_name: "示例实例",
      admin: { username: "owner", email: "owner@example.test", password: "owner-password-123" },
      course_pack: {
        "course.json": JSON.stringify({ id: "large", slug: "large", title: "超限课程", entry: "start.txt" }),
        "start.txt": "say:导师:欢迎;end;",
        "large.txt": "x".repeat(1_500_000),
      },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PACK_TOO_LARGE" } });
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM instance_settings").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);
  });

  it("非法课程包初始化失败且不落库", async () => {
    const f = await fixture();
    const response = await f.call("/api/v1/setup", {
      instance_name: "示例实例",
      admin: { username: "owner", email: "owner@example.test", password: "owner-password-123" },
      course_pack: { "course.json": "{}", "start.txt": "" },
    });
    expect(response.status).toBe(400);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
  });
});
