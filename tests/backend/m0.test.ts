import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";
import { builtin, SqliteD1 } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

function fixture(overrides: Partial<Env> = {}) {
  const db = new SqliteD1();
  dbs.push(db);
  db.sqlite.exec(fs.readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
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
    admin: { email: "admin@example.test", password: "admin-password-123" },
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function batch(f: ReturnType<typeof fixture>, adminCookie: string) {
  const response = await f.call("/api/v1/admin/accounts/batch", {
    csv: "email,display_name\nalice@example.test,Alice\nbob@example.test,Bob\n",
  }, adminCookie);
  expect(response.status).toBe(201);
  return (await response.json()) as { csv: string; download_url: string; count: number };
}

describe("M0 · 账号与课程下发（设计书 §8 验收标准）", () => {
  it("未登录访问课程 API 返回 401", async () => {
    const f = fixture();
    expect((await f.call("/api/v1/courses")).status).toBe(401);
    expect((await f.call("/api/v1/courses/demo/pack")).status).toBe(401);
    expect((await f.call("/api/v1/progress/demo")).status).toBe(401);
  });

  it("批量发号后学员可登录并拉到课程；临时密码必须先修改", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await batch(f, admin);
    expect(issued.count).toBe(2);
    expect(issued.csv).toContain("alice@example.test");

    const uploaded = await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    expect(uploaded.status).toBe(201);

    const password = issued.csv.split("\n")[1]!.split(",")[2]!;
    const login = await f.call("/api/v1/auth/login", { email: "alice@example.test", password });
    expect(login.status).toBe(200);
    const student = login.headers.get("set-cookie")!.split(";")[0]!;
    expect((await login.json() as { must_change_password: boolean }).must_change_password).toBe(true);

    expect((await f.call("/api/v1/courses", undefined, student)).status).toBe(403);
    const changed = await f.call("/api/v1/auth/password", {
      current_password: password, new_password: "new-password-123",
    }, student);
    expect(changed.status).toBe(200);

    const relogin = await f.call("/api/v1/auth/login", { email: "alice@example.test", password: "new-password-123" });
    const session = relogin.headers.get("set-cookie")!.split(";")[0]!;
    const list = await f.call("/api/v1/courses", undefined, session);
    expect(list.status).toBe(200);
    const course = ((await list.json()) as { courses: { id: string; slug: string }[] }).courses[0]!;
    expect(course.slug).toBe("demo");

    const pack = await f.call(`/api/v1/courses/${course.id}/pack`, undefined, session);
    expect(((await pack.json()) as { pack: Record<string, string> }).pack["start.txt"]).toContain("code:ch01");

    const file = await f.call(`/api/v1/courses/${course.id}/files/challenges/ch01.json`, undefined, session);
    expect(file.status).toBe(200);
    expect(((await file.json()) as { id: string }).id).toBe("ch01");
  });

  it("注册接口默认关闭，可由开关打开", async () => {
    const f = fixture();
    const body = { email: "new@example.test", password: "registration-password-123" };
    expect((await f.call("/api/v1/auth/register", body)).status).toBe(403);
    const enabled = fixture({ REGISTRATION_ENABLED: "true" });
    const response = await enabled.call("/api/v1/auth/register", body);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { user: { role: string } }).user.role).toBe("member");
  });

  it("发放表下载链接只能用一次", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await batch(f, admin);
    expect((await f.call(issued.download_url)).status).toBe(200);
    expect((await f.call(issued.download_url)).status).toBe(404);
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
    const password = issued.csv.split("\n")[1]!.split(",")[2]!;
    const firstLogin = await f.call("/api/v1/auth/login", { email: "alice@example.test", password });
    await f.call("/api/v1/auth/password", {
      current_password: password, new_password: "new-password-123",
    }, loginCookie(firstLogin));
    // 首次改密撤销会话，这里用新密码重新登录得到的 Cookie。
    const relogin = await f.call("/api/v1/auth/login", { email: "alice@example.test", password: "new-password-123" });
    const cookie = loginCookie(relogin);
    const courses = (await (await f.call("/api/v1/courses", undefined, cookie)).json()) as { courses: { id: string }[] };
    const id = courses.courses[0]!.id;

    expect((await f.call(`/api/v1/progress/${id}`, { vars: { a: 1 }, challenges: { ch01: { passed: true, score: 100 } }, hints: ["h1"] }, cookie, "PUT")).status).toBe(200);
    await f.call(`/api/v1/progress/${id}`, { vars: { b: 2 }, hints: ["h2"] }, cookie, "PUT");
    const progress = (await (await f.call(`/api/v1/progress/${id}`, undefined, cookie)).json()) as {
      progress: { vars: Record<string, number>; challenges: Record<string, unknown>; hints: string[] };
    };
    expect(progress.progress.vars).toEqual({ a: 1, b: 2 });
    expect(progress.progress.challenges.ch01).toMatchObject({ passed: true });
    expect(progress.progress.hints).toEqual(["h1", "h2"]);
  });
});

function loginCookie(response: Response): string {
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
