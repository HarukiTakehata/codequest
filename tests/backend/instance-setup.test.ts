import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";
import { applyAllMigrations, SqliteD1 } from "../helpers/sqlite-d1";
import { MemoryR2 } from "../helpers/memory-r2";

const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

const coursePack = {
  "course.json": JSON.stringify({ id: "init", slug: "init", title: "初始化课程", entry: "start.txt" }),
  "start.txt": "say:导师:初始化;end;",
};

function fixture(overrides: Partial<Env> = {}) {
  const db = new SqliteD1();
  dbs.push(db);
  applyAllMigrations(db);
  const r2 = new MemoryR2();
  const env = { DB: db.asD1(), COURSE_PACKS: r2.asR2(), TOKEN_PEPPER: "test-pepper", ENVIRONMENT: "test", ...overrides } as Env;
  const app = createApp();
  const call = (path: string, body?: unknown, cookie?: string, method?: string) =>
    app.fetch(new Request(`https://test.local${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  return { db, r2, env, call };
}

function setupRequest(credentials = {
  username: " Admin.User ", email: "ADMIN@Example.Test", password: "admin-password-123", display_name: " Owner ",
}) {
  return {
    path: "/api/v1/setup",
    body: { instance_name: " 共享初始化 ", admin: credentials, course_pack: coursePack },
    instanceName: "共享初始化",
  };
}

describe("唯一实例初始化入口", () => {
  it("/setup 创建管理员、实例、课程、审计与会话", async () => {
    const f = fixture();
    const request = setupRequest();
    const response = await f.call(request.path, request.body);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      user: { username: "admin.user", email: "admin@example.test", display_name: "Owner", role: "admin", must_change_password: false },
      instance_name: request.instanceName,
    });
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(1);
    expect(f.db.sqlite.prepare("SELECT username, email FROM users").get()).toEqual({ username: "admin.user", email: "admin@example.test" });
    expect(f.db.sqlite.prepare("SELECT v FROM instance_settings WHERE k = 'instance_name'").get()?.v).toBe(request.instanceName);
    expect(f.db.sqlite.prepare("SELECT event_type FROM user_auth_events").all()).toEqual([{ event_type: "bootstrap" }]);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM user_sessions").get()?.n).toBe(1);
    const course = f.db.sqlite.prepare("SELECT pack_json, pack_key FROM courses").get();
    expect(course).toMatchObject({ pack_json: null });
    expect(course?.pack_key).toMatch(/^courses\/crs_[^/]+\/1\/upl_[^/]+\.json$/);
    expect(f.r2.objects.get(String(course?.pack_key))?.body).toBe(JSON.stringify(coursePack));
    expect((await f.call("/api/v1/me", undefined, cookie)).status).toBe(200);
    expect(await (await f.call("/api/v1/setup/status")).json()).toMatchObject({
      needs_setup: false, instance_name: request.instanceName, admin_url: "/admin/",
    });
    expect(await (await f.call("/api/v1/auth/status")).json()).toMatchObject({ needs_bootstrap: false, setup_url: "/setup" });
    expect((await f.call("/")).status).not.toBe(302);
  });

  it("/setup 支持无邮箱管理员并返回公开用户名", async () => {
    const f = fixture();
    const credentials = { username: " Owner.User ", password: "admin-password-123" };
    const response = await f.call("/api/v1/setup", { instance_name: "无邮箱实例", admin: credentials });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ user: { username: "owner.user", email: null, role: "admin" } });
    expect(f.db.sqlite.prepare("SELECT username, email FROM users").get()).toEqual({ username: "owner.user", email: null });
    const login = await f.call("/api/v1/auth/login", { identifier: "OWNER.USER", password: credentials.password });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ user: { username: "owner.user", email: null } });
  });

  it("setup/status 返回去除首尾空白后的 ADMIN_URL，空值时回退 /admin/", async () => {
    const configured = fixture({ ADMIN_URL: " https://admin.example.test/console/ " });
    expect(await (await configured.call("/api/v1/setup/status")).json()).toMatchObject({
      admin_url: "https://admin.example.test/console/",
    });
    const fallback = fixture({ ADMIN_URL: "   " });
    expect(await (await fallback.call("/api/v1/setup/status")).json()).toMatchObject({ admin_url: "/admin/" });
  });

  it("auth/status 指向唯一 /setup 入口，并兼容独立学习端子域", async () => {
    const fallback = fixture();
    expect(await (await fallback.call("/api/v1/auth/status")).json()).toMatchObject({
      needs_bootstrap: true, setup_url: "/setup",
    });
    const configured = fixture({ LEARNER_URL: " https://learn.example.test/app/ " });
    expect(await (await configured.call("/api/v1/auth/status")).json()).toMatchObject({
      needs_bootstrap: true, setup_url: "https://learn.example.test/app/setup",
    });
  });

  it("重复初始化返回 SETUP_COMPLETED，旧 /auth/bootstrap 路由不再存在", async () => {
    const f = fixture();
    const request = setupRequest();
    const initialized = await f.call(request.path, request.body);
    expect(initialized.status).toBe(201);
    const cookie = initialized.headers.get("set-cookie")!.split(";")[0]!;
    const response = await f.call(request.path, request.body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "SETUP_COMPLETED" } });
    expect((await f.call("/api/v1/auth/bootstrap", request.body.admin, cookie)).status).toBe(404);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(1);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(1);
  });

  it("并发初始化只有一个赢家，失败方只清理自己的 R2 key", async () => {
    const f = fixture();
    const request = setupRequest();
    const responses = await Promise.all([
      f.call(request.path, request.body),
      f.call(request.path, request.body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(1);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(1);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM user_auth_events WHERE event_type = 'bootstrap'").get()?.n).toBe(1);
    expect(f.r2.objects.size).toBe(1);
    expect(f.r2.puts).toHaveLength(2);
    expect(f.r2.deletes).toHaveLength(1);
    const stored = f.db.sqlite.prepare("SELECT pack_key FROM courses").get();
    expect(f.r2.objects.has(String(stored?.pack_key))).toBe(true);
  });

  it("初始化携带课程包时 R2 失败不产生任何数据库状态", async () => {
    const f = fixture();
    f.r2.putError = new Error("R2 unavailable");
    const request = setupRequest();
    const response = await f.call(request.path, request.body);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "COURSE_PACK_WRITE_FAILED" } });
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM instance_settings").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM user_auth_events").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM user_sessions").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("初始化 D1 batch 失败时管理员、课程、审计、会话全部回滚并清理 R2", async () => {
    const f = fixture();
    f.db.sqlite.exec(`CREATE TRIGGER fail_initial_user BEFORE INSERT ON users
      BEGIN SELECT RAISE(ABORT, 'forced initialization failure'); END;`);
    const request = setupRequest();
    const response = await f.call(request.path, request.body);
    expect(response.status).toBe(409);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM instance_settings").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM user_auth_events").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM user_sessions").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);
    expect(f.r2.puts).toHaveLength(1);
    expect(f.r2.deletes).toEqual(f.r2.puts);
    expect(f.r2.objects.size).toBe(0);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("初始化课程包超限时不写 D1、不调用 R2", async () => {
    const f = fixture();
    const request = setupRequest();
    const response = await f.call(request.path, {
      ...request.body,
      course_pack: { ...coursePack, "large.txt": "x".repeat(1_500_000) },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PACK_TOO_LARGE" } });
    expect(f.r2.puts).toEqual([]);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM instance_settings").get()?.n).toBe(0);
  });

  it("bootstrap claim 已存在时状态接口与 /setup 一致拒绝", async () => {
    const f = fixture();
    f.db.sqlite.prepare("INSERT INTO instance_settings (k, v) VALUES ('bootstrap_claim', 'usr_claim')").run();
    expect(await (await f.call("/api/v1/setup/status")).json()).toMatchObject({ needs_setup: false });
    expect(await (await f.call("/api/v1/auth/status")).json()).toMatchObject({ needs_bootstrap: false, setup_url: "/setup" });
    expect((await f.call("/")).status).not.toBe(302);
    const request = setupRequest();
    expect((await f.call(request.path, request.body)).status).toBe(409);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
  });
});
