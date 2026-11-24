import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import { parseRoster } from "../../src/lib/csv";
import type { Env } from "../../src/types";
import { applyAllMigrations, SqliteD1 } from "../helpers/sqlite-d1";

const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

function fixture(overrides: Partial<Env> = {}) {
  const db = new SqliteD1();
  dbs.push(db);
  applyAllMigrations(db);
  const env = {
    DB: db.asD1(), TOKEN_PEPPER: "test-pepper", ENVIRONMENT: "test",
    REGISTRATION_ENABLED: "false", ...overrides,
  } as Env;
  const app = createApp();
  const call = (path: string, body?: unknown, cookie?: string, method?: string) =>
    app.fetch(new Request(`https://test.local${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  return { db, env, call };
}

const demoPack = {
  "course.json": JSON.stringify({
    id: "demo", slug: "demo", title: "演示课程", summary: "M0 验收用",
    langs: ["javascript", "python"], entry: "start.txt",
  }),
  "start.txt": "changeBg:main;say:导师:欢迎来到 CodeQuest;code:ch01 -lang=javascript;",
  "challenges/ch01.json": JSON.stringify({
    id: "ch01", title: "第一个挑战", lang: "javascript", template: "// TODO",
    judge: "j01", goals: [{ id: "g1", text: "包含输出", check: { kind: "source-regex", pattern: "console\\.log" } }],
  }),
  "judges/j01.json": JSON.stringify({
    id: "j01", cases: [{ id: "t1", name: "样例", stdin: "", expected: "hello\n" }],
  }),
};

async function setup(f: ReturnType<typeof fixture>) {
  const response = await f.call("/api/v1/setup", {
    instance_name: "测试实例",
    admin: { username: " Admin.Owner ", email: "ADMIN@Example.Test", password: "admin-password-123" },
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function batch(f: ReturnType<typeof fixture>, adminCookie: string) {
  const response = await f.call("/api/v1/admin/accounts/batch", {
    csv: "username,email,display_name\nalice,alice@example.test,Alice\nbob,,Bob\n",
  }, adminCookie);
  expect(response.status).toBe(201);
  const issued = (await response.json()) as {
    batch: { id: string; count: number; expires_at: string };
    download_url: string;
  };
  expect(issued.batch.count).toBe(2);
  expect(issued).not.toHaveProperty("csv");
  return issued;
}

async function issuedPasswords(f: ReturnType<typeof fixture>, downloadUrl: string) {
  const response = await f.call(downloadUrl);
  expect(response.status).toBe(200);
  return parseRoster(await response.text());
}

describe("M0 · 账号与课程下发（设计书 §8 验收标准）", () => {
  it("未登录访问课程 API 返回 401", async () => {
    const f = fixture();
    expect((await f.call("/api/v1/courses")).status).toBe(401);
    expect((await f.call("/api/v1/courses/demo/pack")).status).toBe(401);
    expect((await f.call("/api/v1/progress/demo")).status).toBe(401);
  });

  it("批量发号后学员可登录；课程接口当前固定返回空目录", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await batch(f, admin);
    const passwords = await issuedPasswords(f, issued.download_url);
    expect(passwords[0]).toMatchObject({ username: "alice", email: "alice@example.test" });
    expect(passwords[1]).toMatchObject({ username: "bob", email: null, display_name: "Bob" });

    const uploaded = await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    expect(uploaded.status).toBe(201);

    const password = passwords[0]!.password!;
    const login = await f.call("/api/v1/auth/login", { identifier: " ALICE ", password });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({
      user: { username: "alice", email: "alice@example.test" }, must_change_password: true,
    });
    const student = login.headers.get("set-cookie")!.split(";")[0]!;

    expect((await f.call("/api/v1/me", undefined, student)).status).toBe(200);
    expect((await f.call("/api/v1/me", { display_name: "Temp" }, student, "PATCH")).status).toBe(403);
    expect((await f.call("/api/v1/courses", undefined, student)).status).toBe(403);
    const changed = await f.call("/api/v1/auth/password", {
      current_password: password, new_password: "new-password-123",
    }, student);
    expect(changed.status).toBe(200);

    const relogin = await f.call("/api/v1/auth/login", { identifier: "ALICE@EXAMPLE.TEST", password: "new-password-123" });
    const session = relogin.headers.get("set-cookie")!.split(";")[0]!;
    const list = await f.call("/api/v1/courses", undefined, session);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ courses: [] });
    expect((await f.call("/api/v1/courses/demo/pack", undefined, session)).status).toBe(404);
    expect((await f.call("/api/v1/courses/demo/files/challenges/ch01.json", undefined, session)).status).toBe(404);
  });

  it("用户可查看并修改自己的显示名，空值与占位符回退为用户名", async () => {
    const f = fixture();
    const admin = await setup(f);
    expect((await f.call("/api/v1/me", undefined, admin)).status).toBe(200);

    const updated = await f.call("/api/v1/me", { display_name: "  New Owner  " }, admin, "PATCH");
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ user: { username: "admin.owner", display_name: "New Owner" } });
    expect(f.db.sqlite.prepare("SELECT display_name FROM users WHERE username = 'admin.owner'").get()?.display_name)
      .toBe("New Owner");

    const cleared = await f.call("/api/v1/me", { display_name: "?????" }, admin, "PATCH");
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ user: { display_name: null } });

    expect((await f.call("/api/v1/me", {}, admin, "PATCH")).status).toBe(400);
    expect((await f.call("/api/v1/me", { display_name: "No Session" }, undefined, "PATCH")).status).toBe(401);
  });

  it("注册接口默认关闭，可由开关打开", async () => {
    const f = fixture();
    const body = { username: " New.User ", password: "registration-password-123" };
    expect((await f.call("/api/v1/auth/register", body)).status).toBe(403);
    const enabled = fixture({ REGISTRATION_ENABLED: "true" });
    const response = await enabled.call("/api/v1/auth/register", body);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ user: { username: "new.user", email: null, role: "student" } });
    expect(enabled.db.sqlite.prepare("SELECT username, email, role FROM users WHERE username = ?").get("new.user"))
      .toEqual({ username: "new.user", email: null, role: "student" });
    expect((await enabled.call("/api/v1/auth/register", {
      username: "NEW.USER", password: "another-password-123",
    })).status).toBe(409);
    expect((await enabled.call("/api/v1/auth/register", {
      username: "mail.user", email: " Mail@Example.Test ", password: "mail-password-123",
    })).status).toBe(201);
    expect((await enabled.call("/api/v1/auth/register", {
      username: "other.user", email: "MAIL@example.test", password: "other-password-123",
    })).status).toBe(409);
  });

  it("初始化与普通注册分别记录 bootstrap 和 register 审计事件", async () => {
    const f = fixture({ REGISTRATION_ENABLED: "true" });
    const setup = await f.call("/api/v1/setup", {
      instance_name: "审计测试实例",
      admin: { username: " Root.User ", password: "admin-password-123" },
    });
    expect(setup.status).toBe(201);
    expect(await setup.json()).toMatchObject({ user: { username: "root.user", email: null } });
    const registered = await f.call("/api/v1/auth/register", {
      username: "Registered.User", password: "registration-password-123",
    });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ user: { username: "registered.user", email: null } });
    const events = f.db.sqlite.prepare(`
      SELECT identifier, event_type FROM user_auth_events ORDER BY rowid
    `).all();
    expect(events).toEqual([
      { identifier: "root.user", event_type: "bootstrap" },
      { identifier: "registered.user", event_type: "register" },
    ]);
  });

  it("发放表下载链接只能用一次", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await batch(f, admin);
    expect((await f.call(issued.download_url)).status).toBe(200);
    expect((await f.call(issued.download_url)).status).toBe(404);
    expect(f.db.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = ?").get(issued.batch.id)?.csv_text).toBeNull();
  });

  it("课程包上传校验：拒绝不存在的判题引用与路径穿越", async () => {
    const f = fixture();
    const admin = await setup(f);
    const broken = structuredClone(demoPack);
    broken["challenges/ch01.json"] = JSON.stringify({
      id: "ch01", title: "坏题", lang: "javascript", judge: "missing",
    });
    expect((await f.call("/api/v1/admin/courses", { pack: broken }, admin)).status).toBe(400);
    const evil = { ...demoPack, "../secret.txt": "leak" };
    expect((await f.call("/api/v1/admin/courses", { pack: evil }, admin)).status).toBe(400);
  });

  it("进度保存支持离线合并（challenges/vars/hints）", async () => {
    const f = fixture();
    const admin = await setup(f);
    await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    const issued = await batch(f, admin);
    const passwords = await issuedPasswords(f, issued.download_url);
    const password = passwords[0]!.password!;
    const firstLogin = await f.call("/api/v1/auth/login", { identifier: "alice", password });
    await f.call("/api/v1/auth/password", {
      current_password: password, new_password: "new-password-123",
    }, loginCookie(firstLogin));
    // 首次改密撤销会话，这里用新密码重新登录得到的 Cookie。
    const relogin = await f.call("/api/v1/auth/login", { identifier: "ALICE@EXAMPLE.TEST", password: "new-password-123" });
    const cookie = loginCookie(relogin);
    // 学习端目录固定为空，但管理端仍可持有课程元数据；进度外键需要真实课程 id。
    const adminCourses = (await (await f.call("/api/v1/admin/courses", undefined, admin)).json()) as { courses: { id: string }[] };
    const id = adminCourses.courses[0]!.id;

    expect((await f.call(`/api/v1/progress/${id}`, { vars: { a: 1 }, challenges: { ch01: { passed: true, score: 100 } }, hints: ["h1"] }, cookie, "PUT")).status).toBe(200);
    await f.call(`/api/v1/progress/${id}`, { vars: { b: 2 }, hints: ["h2"] }, cookie, "PUT");
    const progress = (await (await f.call(`/api/v1/progress/${id}`, undefined, cookie)).json()) as {
      progress: { vars: Record<string, number>; challenges: Record<string, unknown>; hints: string[] };
    };
    expect(progress.progress.vars).toEqual({ a: 1, b: 2 });
    expect(progress.progress.challenges.ch01).toMatchObject({ passed: true });
    expect(progress.progress.hints).toEqual(["h1", "h2"]);
  });

  it("父域会话 Cookie 与管理员校验接口支持独立编辑器子域", async () => {
    const f = fixture({ SESSION_COOKIE_DOMAIN: ".example.test" });
    const response = await f.call("/api/v1/setup", {
      instance_name: "测试实例",
      admin: { username: " Admin.Owner ", email: "ADMIN@Example.Test", password: "admin-password-123" },
    });
    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain("Domain=.example.test");
    const admin = setCookie.split(";")[0]!;

    // nginx auth_request：管理员 204，未登录 401。
    expect((await f.call("/api/v1/admin/check", undefined, admin)).status).toBe(204);
    expect((await f.call("/api/v1/admin/check")).status).toBe(401);
  });
});

function loginCookie(response: Response): string {
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
