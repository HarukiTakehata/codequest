import { afterEach, describe, expect, it } from "vitest";
import worker, { createApp } from "../../src/index";
import { sha256Hex } from "../../src/lib/crypto";
import { parseRoster } from "../../src/lib/csv";
import type { Env, UserRole } from "../../src/types";
import { applyAllMigrations, builtin, SqliteD1 } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string; readdirSync(path: URL): string[] }>("node:fs");
const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

interface IssuedBatch {
  id: string;
  filename: string;
  count: number;
  status: "pending" | "downloaded" | "expired" | "revoked";
  expires_at: string;
  downloaded_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface IssuedResponse {
  batch: IssuedBatch;
  download_url: string;
}

interface AdminAccount {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  status: "active" | "disabled";
  must_change_password: boolean;
  created_at: string;
  last_seen_at: string | null;
  password_updated_at: string | null;
  batch_id: string | null;
  batch_filename: string | null;
}

interface AuditEvent {
  id: string;
  actor_id: string;
  actor_username: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const demoPack = {
  "course.json": JSON.stringify({
    id: "demo", slug: "demo", title: "演示课程", summary: "M6.1 验收",
    langs: ["javascript"], entry: "start.txt",
  }),
  "start.txt": "say:导师:欢迎;end;",
};

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

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function setup(f: ReturnType<typeof fixture>, email: string | null = "admin@example.test") {
  const response = await f.call("/api/v1/setup", {
    instance_name: "M6.1 测试实例",
    admin: { username: "admin", ...(email ? { email } : {}), password: "admin-password-123" },
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function registerStudent(f: ReturnType<typeof fixture>, username: string, password: string, email?: string) {
  const response = await f.call("/api/v1/auth/register", {
    username, ...(email ? { email } : {}), password, display_name: username,
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function issue(
  f: ReturnType<typeof fixture>, staff: string, csv: string, filename?: string,
  role: "student" | "teacher" = "student",
): Promise<IssuedResponse> {
  const response = await f.call("/api/v1/admin/accounts/batch", {
    csv, ...(role === "teacher" ? { role } : {}), ...(filename ? { filename } : {}),
  }, staff);
  expect(response.status).toBe(201);
  const issued = await json<IssuedResponse>(response);
  expect(Object.keys(issued).sort()).toEqual(["batch", "download_url"]);
  expect(issued.batch.count).toBeGreaterThan(0);
  return issued;
}

async function createTeacher(
  f: ReturnType<typeof fixture>, admin: string, username = "teacher",
): Promise<{ id: string; cookie: string; password: string }> {
  const email = `${username}@example.test`;
  const initialPassword = "teacher-initial-password-123";
  const readyPassword = "teacher-ready-password-123";
  const issued = await issue(f, admin, `${username},${email},Teacher,${initialPassword}`, undefined, "teacher");
  const exported = parseRoster(await (await download(f, issued.download_url)).text());
  expect(exported[0]).toMatchObject({ username, email, password: initialPassword });
  const login = await f.call("/api/v1/auth/login", { identifier: username, password: initialPassword });
  expect(login.status).toBe(200);
  const initialCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  expect((await f.call("/api/v1/auth/password", {
    current_password: initialPassword, new_password: readyPassword,
  }, initialCookie)).status).toBe(200);
  const relogin = await f.call("/api/v1/auth/login", { identifier: email, password: readyPassword });
  expect(relogin.status).toBe(200);
  const id = String(f.db.sqlite.prepare("SELECT id FROM users WHERE username = ?").get(username)?.id);
  return { id, cookie: relogin.headers.get("set-cookie")!.split(";")[0]!, password: readyPassword };
}

async function download(f: ReturnType<typeof fixture>, url: string): Promise<Response> {
  return await f.call(url);
}

function count(f: ReturnType<typeof fixture>, table: "users" | "issued_batches" | "user_issuance" | "admin_audit_events") {
  return Number(f.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
}

function protectedRequests(token: string): { method: string; path: string; body?: unknown }[] {
  return [
    { method: "GET", path: "/api/v1/admin/check" },
    { method: "GET", path: "/api/v1/admin/config" },
    { method: "GET", path: "/api/v1/admin/overview" },
    { method: "GET", path: "/api/v1/admin/audit" },
    { method: "GET", path: "/api/v1/admin/accounts" },
    { method: "GET", path: "/api/v1/admin/accounts/batches" },
    { method: "GET", path: "/api/v1/admin/courses" },
    { method: "POST", path: "/api/v1/admin/accounts/batch/preview", body: { csv: "a,a@example.test,A" } },
    { method: "POST", path: "/api/v1/admin/accounts/batch", body: { csv: "a,a@example.test,A" } },
    { method: "DELETE", path: "/api/v1/admin/accounts/batches/bat_missing" },
    { method: "PATCH", path: "/api/v1/admin/accounts/usr_missing", body: { status: "disabled" } },
    { method: "POST", path: "/api/v1/admin/accounts/usr_missing/password-reset" },
    { method: "POST", path: "/api/v1/admin/courses", body: { pack: demoPack } },
    { method: "PATCH", path: "/api/v1/admin/courses/crs_missing", body: { enabled: false } },
    // 非 GET 或路径不精确时，下载前缀不是免登录例外。
    { method: "POST", path: `/api/v1/admin/accounts/download/${token}` },
    { method: "GET", path: `/api/v1/admin/accounts/download/${token}/extra` },
    { method: "GET", path: "/api/v1/admin/accounts/download" },
    { method: "GET", path: `/api/v1/admin/accounts/batch/download/${token}` },
  ];
}

describe("M6.1 管理 API · 门禁与配置", () => {
  it("未登录管理接口均返回 401；仅精确匹配的 GET 下载链接免登录", async () => {
    const f = fixture({ EDITOR_URL: " https://editor.example.test ", LEARNER_URL: "" });
    const admin = await setup(f);
    const issued = await issue(f, admin, "alice,alice@example.test,Alice,specified-password-123");
    for (const request of protectedRequests(issued.download_url.split("/").at(-1)!)) {
      const response = await f.call(request.path, request.body, undefined, request.method);
      expect(response.status, `${request.method} ${request.path}`).toBe(401);
    }
    const unauthenticated = await f.call("/api/v1/admin/overview");
    expect(unauthenticated.headers.get("cache-control")).toBe("no-store");
    expect(unauthenticated.headers.get("referrer-policy")).toBe("no-referrer");
    expect(unauthenticated.headers.get("x-content-type-options")).toBe("nosniff");
    const downloaded = await download(f, issued.download_url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await downloaded.text()).toContain("alice@example.test");
    expect((await download(f, "/api/v1/admin/accounts/download/not-a-valid-token")).status).toBe(404);

    const config = await json<{
      instance_name: string; editor_url: string | null; learner_url: string | null; download_link_ttl_hours: number;
    }>(
      await f.call("/api/v1/admin/config", undefined, admin),
    );
    expect(config).toEqual({
      instance_name: "M6.1 测试实例",
      editor_url: "https://editor.example.test", learner_url: null, download_link_ttl_hours: 24,
    });
  });

  it("实例名缺失时管理配置回退到 CodeQuest", async () => {
    const f = fixture();
    const admin = await setup(f);
    f.db.sqlite.prepare("DELETE FROM instance_settings WHERE k = 'instance_name'").run();
    const config = await json<{ instance_name: string }>(await f.call("/api/v1/admin/config", undefined, admin));
    expect(config.instance_name).toBe("CodeQuest");
  });

  it("普通学生访问全部管理接口返回 403", async () => {
    const f = fixture({ REGISTRATION_ENABLED: "true" });
    const admin = await setup(f);
    const student = await registerStudent(f, "student", "student-password-123", "student@example.test");
    const issued = await issue(f, admin, "alice,alice@example.test,Alice,specified-password-123");
    for (const request of protectedRequests(issued.download_url.split("/").at(-1)!)) {
      const response = await f.call(request.path, request.body, student, request.method);
      expect(response.status, `${request.method} ${request.path}`).toBe(403);
    }
  });

  it("教师可管理课程与学生，概览不泄露审计", async () => {
    const f = fixture();
    const admin = await setup(f);
    const teacher = await createTeacher(f, admin);
    expect((await f.call("/api/v1/admin/check", undefined, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/audit", undefined, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/config", undefined, teacher.cookie)).status).toBe(200);

    await issue(f, teacher.cookie, "alice,alice@example.test,Alice,alice-password-123", "students.csv");
    const accounts = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts", undefined, teacher.cookie),
    );
    expect(accounts.total).toBe(1);
    expect(accounts.accounts[0]).toMatchObject({ email: "alice@example.test", role: "student" });
    const overview = await json<{
      accounts: { total: number };
      teachers: { total: number; active: number; disabled: number; password_change_required: number };
      recent_audit: AuditEvent[];
    }>(await f.call("/api/v1/admin/overview", undefined, teacher.cookie));
    expect(overview.accounts.total).toBe(1);
    expect(overview.teachers).toEqual({ total: 1, active: 1, disabled: 0, password_change_required: 0 });
    expect(overview.recent_audit).toEqual([]);
    const adminOverview = await json<{ recent_audit: AuditEvent[] }>(
      await f.call("/api/v1/admin/overview", undefined, admin),
    );
    expect(adminOverview.recent_audit.length).toBeGreaterThan(0);

    const student = accounts.accounts[0]!;
    expect((await f.call(`/api/v1/admin/accounts/${student.id}`, { status: "disabled" }, teacher.cookie, "PATCH")).status).toBe(200);
    expect((await f.call(`/api/v1/admin/accounts/${student.id}/password-reset`, undefined, teacher.cookie, "POST")).status).toBe(200);
    expect((await f.call(`/api/v1/admin/accounts/${student.id}`, { status: "active" }, teacher.cookie, "PATCH")).status).toBe(200);
    expect((await f.call("/api/v1/admin/courses", { pack: demoPack }, teacher.cookie)).status).toBe(201);
    const courses = await json<{ courses: { id: string }[] }>(await f.call("/api/v1/admin/courses", undefined, teacher.cookie));
    expect((await f.call(`/api/v1/admin/courses/${courses.courses[0]!.id}`, { enabled: false }, teacher.cookie, "PATCH")).status).toBe(200);
    const batches = await json<{ batches: IssuedBatch[]; total: number }>(
      await f.call("/api/v1/admin/accounts/batches", undefined, teacher.cookie),
    );
    expect(batches.total).toBe(1);
    expect(batches.batches[0]?.filename).toBe("students.csv");
  });

  it("教师不能查看审计、管理教师或发放教师账号", async () => {
    const f = fixture();
    const admin = await setup(f);
    const teacher = await createTeacher(f, admin);
    const otherTeacher = await createTeacher(f, admin, "other-teacher");
    const before = [count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")];

    expect((await f.call("/api/v1/admin/check", undefined, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/audit", undefined, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/accounts?role=teacher", undefined, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/accounts?role=admin", undefined, teacher.cookie)).status).toBe(403);
    const hidden = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?query=other-teacher", undefined, teacher.cookie),
    );
    expect(hidden).toMatchObject({ total: 0, accounts: [] });
    expect((await f.call(`/api/v1/admin/accounts/${otherTeacher.id}`, { display_name: "Changed" }, teacher.cookie, "PATCH")).status).toBe(404);
    expect((await f.call(`/api/v1/admin/accounts/${otherTeacher.id}`, { status: "disabled" }, teacher.cookie, "PATCH")).status).toBe(404);
    expect((await f.call(`/api/v1/admin/accounts/${otherTeacher.id}/password-reset`, undefined, teacher.cookie, "POST")).status).toBe(404);
    expect((await f.call(`/api/v1/admin/accounts/${otherTeacher.id}`, { role: "student" }, teacher.cookie, "PATCH")).status).toBe(403);

    const teacherCsv = "new-teacher,new-teacher@example.test,New Teacher,teacher-password-123";
    expect((await f.call("/api/v1/admin/accounts/batch/preview", { csv: teacherCsv, role: "teacher" }, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/accounts/batch", { csv: teacherCsv, role: "teacher" }, teacher.cookie)).status).toBe(403);
    const teacherBatches = await json<{ batches: IssuedBatch[]; total: number }>(
      await f.call("/api/v1/admin/accounts/batches", undefined, teacher.cookie),
    );
    expect(teacherBatches).toMatchObject({ total: 0, batches: [] });
    const otherBatch = f.db.sqlite.prepare(`
      SELECT b.id FROM issued_batches b JOIN user_issuance ui ON ui.batch_id = b.id
      JOIN users u ON u.id = ui.user_id WHERE u.email = 'other-teacher@example.test'
    `).get();
    expect((await f.call(`/api/v1/admin/accounts/batches/${otherBatch?.id}`, undefined, teacher.cookie, "DELETE")).status).toBe(404);

    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);
    expect(f.db.sqlite.prepare("SELECT role, status, display_name FROM users WHERE id = ?").get(otherTeacher.id))
      .toMatchObject({ role: "teacher", status: "active", display_name: "Teacher" });
    const adminTeachers = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?role=teacher", undefined, admin),
    );
    expect(adminTeachers.total).toBe(2);
    expect(adminTeachers.accounts.every((account) => account.role === "teacher")).toBe(true);
    expect((await f.call("/api/v1/admin/audit", undefined, admin)).status).toBe(200);
  });
});

describe("M6.1 管理 API · 严格 CSV 与预览", () => {
  it("预览支持 BOM、引号/多行、用户名与邮箱规范化及空邮箱，只读且不生成最终密码", async () => {
    const f = fixture();
    const admin = await setup(f);
    const csv = "\uFEFFusername,email,display_name,password\r\n" +
      '" Alice.User "," ALICE@Example.Test ","Team, ""One""\r\nSecond",""\r\n' +
      "bob,,,specified-password-123\r\n";
    const response = await f.call("/api/v1/admin/accounts/batch/preview", { csv, filename: "名单.csv" }, admin);
    expect(response.status).toBe(200);
    const preview = await json<{
      filename: string; count: number; generated_count: number; specified_count: number;
      rows: { username: string; email: string | null; display_name: string; password_mode: string }[];
      conflicts: string[];
    }>(response);
    expect(preview).toEqual({
      filename: "名单.csv", count: 2, generated_count: 1, specified_count: 1,
      rows: [
        { username: "alice.user", email: "alice@example.test", display_name: "Team, \"One\"\nSecond", password_mode: "generated" },
        { username: "bob", email: null, display_name: "bob", password_mode: "specified" },
      ],
      conflicts: [],
    });
    expect(JSON.stringify(preview)).not.toContain("specified-password-123");
    expect(count(f, "users")).toBe(1);
    expect(count(f, "issued_batches")).toBe(0);
    expect(count(f, "admin_audit_events")).toBe(0);
  });

  it("预览报告数据库用户名和邮箱冲突，但不会写库", async () => {
    const f = fixture();
    const admin = await setup(f);
    await issue(f, admin, "alice,alice@example.test,Alice,specified-password-123");
    const before = [count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")];
    const response = await f.call("/api/v1/admin/accounts/batch/preview", {
      csv: "ALICE,other@example.test,Again\nnew,ALICE@example.test,New",
    }, admin);
    expect(response.status).toBe(200);
    expect(await json<{ conflicts: string[]; count: number }>(response)).toMatchObject({
      conflicts: ["alice", "alice@example.test"], count: 2,
    });
    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);
  });

  it("拒绝错误表头、引号、列数、邮箱、重复行与超过 500 行，并给出物理行号", async () => {
    const f = fixture();
    const admin = await setup(f);
    const roster = (length: number) => "username,email,display_name\n" + Array.from({ length }, (_, index) =>
      `user${index},user${index}@example.test,User ${index}`).join("\n");
    const accepted = await f.call("/api/v1/admin/accounts/batch/preview", { csv: roster(500) }, admin);
    expect(accepted.status).toBe(200);
    expect((await json<{ count: number }>(accepted)).count).toBe(500);
    const cases: { csv: string; line: number; message?: string }[] = [
      { csv: "username,name\nalice,alice@example.test,Alice", line: 1, message: "表头" },
      { csv: "username,email,display_name\nalice,alice@example.test,\"unclosed", line: 2, message: "未闭合" },
      { csv: "username,email,display_name\nalice,alice@example.test,bad\"name", line: 2, message: "双引号" },
      { csv: "username,email,display_name\nalice,alice@example.test,\"Bob\"x", line: 2, message: "闭引号" },
      { csv: "username,email,display_name\nalice,alice@example.test,\"Bob\" \"\"", line: 2, message: "闭引号" },
      { csv: "username,email,display_name\nalice,not-an-email,Alice", line: 2, message: "邮箱" },
      { csv: "username,email,display_name\nab,ab@example.test,Alice", line: 2, message: "用户名" },
      { csv: "username,email,display_name\nalice,alice@example.test", line: 2, message: "每行" },
      { csv: "username,email,display_name\nalice,alice@example.test,Alice,pass,extra", line: 2, message: "每行" },
      { csv: "username,email,display_name\nalice,alice@example.test,Alice\nALICE,other@example.test,Again", line: 3, message: "用户名重复" },
      { csv: "username,email,display_name\nalice,same@example.test,Alice\nbob,SAME@example.test,Bob", line: 3, message: "邮箱重复" },
      { csv: "username,email,display_name,password\nalice,alice@example.test,Alice,short", line: 2, message: "密码" },
      { csv: "username,email,display_name,password\nalice,alice@example.test,Alice,=formula-password", line: 2, message: "不能以" },
      { csv: "username,email,display_name\nalice,=formula@example.test,Alice", line: 2, message: "邮箱" },
      { csv: `username,email,display_name\nalice,alice@example.test,${"名".repeat(121)}`, line: 2, message: "显示名称" },
      { csv: "\uFEFF\n", line: 1, message: "没有账号" },
      { csv: "username,email,display_name,password\n", line: 1, message: "没有账号" },
      { csv: roster(501), line: 502, message: "500" },
    ];
    for (const testCase of cases) {
      const response = await f.call("/api/v1/admin/accounts/batch/preview", { csv: testCase.csv }, admin);
      expect(response.status, testCase.csv.slice(0, 60)).toBe(400);
      const error = await json<{ error: { code: string; message: string } }>(response);
      expect(error.error.code).toBe("INVALID_CSV");
      expect(error.error.message).toContain(`第 ${testCase.line} 行`);
      if (testCase.message) expect(error.error.message).toContain(testCase.message);
    }
    for (const filename of ["../accounts.csv", "bad\\name.csv", "bad\nname.csv"]) {
      expect((await f.call("/api/v1/admin/accounts/batch/preview", { csv: "alice,alice@example.test,Alice", filename }, admin)).status).toBe(400);
    }
    expect(count(f, "users")).toBe(1);
    expect(count(f, "issued_batches")).toBe(0);
  });
});

describe("M6.1 管理 API · 原子发号", () => {
  it("正式发号保存 pepper 哈希、来源关系与审计，响应不含 CSV", async () => {
    const f = fixture();
    const admin = await setup(f);
    const specified = "chosen-password-123";
    const issued = await issue(f, admin,
      `alice,alice@example.test,Alice,${specified}\nbob,,Bob,\n`, "students.csv");
    const token = issued.download_url.split("/").at(-1)!;
    expect(token).toHaveLength(43);
    expect(issued.batch).toMatchObject({
      filename: "students.csv", count: 2, status: "pending", downloaded_at: null, revoked_at: null,
    });
    expect(Date.parse(issued.batch.expires_at) - Date.parse(issued.batch.created_at)).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(JSON.stringify(issued)).not.toContain(specified);
    expect(issued).not.toHaveProperty("csv");
    expect(issued).not.toHaveProperty("count");

    const stored = f.db.sqlite.prepare("SELECT * FROM issued_batches WHERE id = ?").get(issued.batch.id);
    expect(stored?.role).toBe("student");
    expect(stored?.download_token_hash).toBe(await sha256Hex(`${token}test-pepper`));
    expect(stored?.download_token_hash).not.toBe(token);
    expect(stored?.csv_text).toContain(specified);
    const issuance = f.db.sqlite.prepare(`
      SELECT u.username, u.email, ui.batch_id FROM user_issuance ui JOIN users u ON u.id = ui.user_id
      WHERE ui.batch_id = ? ORDER BY u.username
    `).all(issued.batch.id);
    expect(issuance).toHaveLength(2);
    expect(issuance.map((row) => [row.username, row.email])).toEqual([
      ["alice", "alice@example.test"], ["bob", null],
    ]);
    expect(issuance.every((row) => row.batch_id === issued.batch.id)).toBe(true);
    expect(f.db.sqlite.prepare("SELECT DISTINCT role FROM users WHERE id IN (SELECT user_id FROM user_issuance WHERE batch_id = ?)")
      .all(issued.batch.id)).toEqual([{ role: "student" }]);
    const audit = f.db.sqlite.prepare("SELECT * FROM admin_audit_events WHERE action = 'batch_created'").get();
    expect(audit?.target_id).toBe(issued.batch.id);
    expect(JSON.parse(String(audit?.metadata_json))).toEqual({ filename: "students.csv", role: "student", count: 2 });
    expect(String(audit?.metadata_json)).not.toContain(specified);
  });

  it("超过 D1 单查询 100 绑定限制的批次按块写入且仍保持原子", async () => {
    const f = fixture();
    const admin = await setup(f);
    const csv = Array.from({ length: 20 }, (_, index) =>
      `student${index},student${index}@example.test,Student ${index},student-password-${index}`).join("\n");
    const issued = await issue(f, admin, csv);
    expect(issued.batch.count).toBe(20);
    expect(count(f, "users")).toBe(21);
    expect(count(f, "user_issuance")).toBe(20);
    const exported = parseRoster(await (await download(f, issued.download_url)).text());
    expect(exported).toHaveLength(20);
    expect(exported[19]?.email).toBe("student19@example.test");
  });

  it("发放 CSV 带 BOM、生成安全密码前缀并转义显示名公式", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await issue(f, admin, 'alice,alice@example.test,"=SUM(1,2)",');
    const bytes = new Uint8Array(await (await download(f, issued.download_url)).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("username,email,display_name,password");
    expect(text).toContain("alice,alice@example.test");
    expect(text).toContain("'=SUM(1,2)");
    expect(text).not.toContain(",=SUM(1,2)");
    const row = parseRoster(text)[0]!;
    expect(row.password).toMatch(/^Cq![A-Za-z0-9_-]{16}$/);
  });

  it("用户名/邮箱占用与数据库唯一约束冲突都会让整批数据回滚", async () => {
    const f = fixture();
    const admin = await setup(f);
    const before = [count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")];
    const emailConflict = await f.call("/api/v1/admin/accounts/batch", {
      csv: "new,new@example.test,New,specified-password-123\nconflict,ADMIN@example.test,Conflict,specified-password-123",
    }, admin);
    expect(emailConflict.status).toBe(409);
    expect(await json<{ error: { code: string } }>(emailConflict)).toMatchObject({ error: { code: "EMAIL_TAKEN" } });
    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);
    expect(f.db.sqlite.prepare("SELECT 1 FROM users WHERE email = 'new@example.test'").get()).toBeUndefined();

    const usernameConflict = await f.call("/api/v1/admin/accounts/batch", {
      csv: "new,new@example.test,New,specified-password-123\nADMIN,other@example.test,Conflict,specified-password-123",
    }, admin);
    expect(usernameConflict.status).toBe(409);
    expect(await json<{ error: { code: string } }>(usernameConflict)).toMatchObject({ error: { code: "USERNAME_TAKEN" } });
    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);

    const duplicateUsername = await f.call("/api/v1/admin/accounts/batch", {
      csv: "same,same@example.test,Same\nSAME,other@example.test,Same Again",
    }, admin);
    expect(duplicateUsername.status).toBe(400);
    const duplicateEmail = await f.call("/api/v1/admin/accounts/batch", {
      csv: "same,same@example.test,Same\nother,SAME@example.test,Other",
    }, admin);
    expect(duplicateEmail.status).toBe(400);
    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);

    // 在预检查之后模拟并发占用：触发器中的真实唯一约束失败必须映射为 409 并整批回滚。
    f.db.sqlite.exec(`CREATE TRIGGER force_identity_conflict BEFORE INSERT ON users
      WHEN NEW.username = 'race'
      BEGIN
        INSERT INTO users (id, username, email, role, status, created_at)
        VALUES ('usr_forced', 'forced', 'admin@example.test', 'student', 'active', NEW.created_at);
      END`);
    const raced = await f.call("/api/v1/admin/accounts/batch", {
      csv: "new,new@example.test,New,specified-password-123\nrace,race@example.test,Race,specified-password-123",
    }, admin);
    expect(raced.status).toBe(409);
    expect(await json<{ error: { code: string } }>(raced)).toMatchObject({ error: { code: "EMAIL_TAKEN" } });
    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);
    expect(f.db.sqlite.prepare("SELECT 1 FROM users WHERE username IN ('new', 'race', 'forced')").get()).toBeUndefined();
  });

  it("教师只能批量创建学生，管理员可显式创建教师且批次按角色隔离", async () => {
    const f = fixture();
    const admin = await setup(f);
    const teacher = await createTeacher(f, admin);
    const before = [count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")];
    const teacherCsv = "blocked-teacher,blocked-teacher@example.test,Blocked Teacher,teacher-password-123";
    expect((await f.call("/api/v1/admin/accounts/batch/preview", { csv: teacherCsv, role: "teacher" }, teacher.cookie)).status).toBe(403);
    expect((await f.call("/api/v1/admin/accounts/batch", { csv: teacherCsv, role: "teacher" }, teacher.cookie)).status).toBe(403);
    expect([count(f, "users"), count(f, "issued_batches"), count(f, "user_issuance"), count(f, "admin_audit_events")]).toEqual(before);

    const studentBatch = await issue(f, teacher.cookie, "new-student,new-student@example.test,New Student,student-password-123");
    const teacherBatch = await issue(f, admin, "new-teacher,new-teacher@example.test,New Teacher,teacher-password-123", undefined, "teacher");
    expect(f.db.sqlite.prepare("SELECT role FROM users WHERE email = 'new-student@example.test'").get()?.role).toBe("student");
    expect(f.db.sqlite.prepare("SELECT role FROM users WHERE email = 'new-teacher@example.test'").get()?.role).toBe("teacher");
    expect(f.db.sqlite.prepare("SELECT role FROM issued_batches WHERE id = ?").get(studentBatch.batch.id)?.role).toBe("student");
    expect(f.db.sqlite.prepare("SELECT role FROM issued_batches WHERE id = ?").get(teacherBatch.batch.id)?.role).toBe("teacher");
    const studentAudit = f.db.sqlite.prepare("SELECT actor_id, metadata_json FROM admin_audit_events WHERE target_id = ?")
      .get(studentBatch.batch.id);
    expect(studentAudit?.actor_id).toBe(teacher.id);
    expect(JSON.parse(String(studentAudit?.metadata_json))).toMatchObject({ role: "student", count: 1 });
    const teacherAudit = f.db.sqlite.prepare("SELECT metadata_json FROM admin_audit_events WHERE target_id = ?")
      .get(teacherBatch.batch.id);
    expect(JSON.parse(String(teacherAudit?.metadata_json))).toMatchObject({ role: "teacher", count: 1 });

    const visible = await json<{ batches: IssuedBatch[]; total: number }>(
      await f.call("/api/v1/admin/accounts/batches", undefined, teacher.cookie),
    );
    expect(visible.total).toBe(1);
    expect(visible.batches.map((batch) => batch.id)).toEqual([studentBatch.batch.id]);
    expect((await f.call(`/api/v1/admin/accounts/batches/${teacherBatch.batch.id}`, undefined, teacher.cookie, "DELETE")).status).toBe(404);
    expect((await f.call(`/api/v1/admin/accounts/batches/${studentBatch.batch.id}`, undefined, teacher.cookie, "DELETE")).status).toBe(200);
    expect(f.db.sqlite.prepare("SELECT revoked_at FROM issued_batches WHERE id = ?").get(teacherBatch.batch.id)?.revoked_at).toBeNull();
  });
});

describe("M6.1 管理 API · 一次性下载与批次", () => {
  it("并发领取只有一方成功，领取后数据库明文清空", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await issue(f, admin, "alice,alice@example.test,Alice,specified-password-123");
    const responses = await Promise.all(Array.from({ length: 8 }, () => download(f, issued.download_url)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 404)).toHaveLength(7);
    const winner = responses.find((response) => response.status === 200)!;
    expect(winner.headers.get("cache-control")).toContain("no-store");
    expect(winner.headers.get("content-type")).toContain("text/csv");
    expect(winner.headers.get("content-disposition")).toContain("attachment");
    expect(parseRoster(await winner.text())[0]).toMatchObject({ username: "alice", email: "alice@example.test", display_name: "Alice" });
    expect((await download(f, issued.download_url)).status).toBe(404);
    const stored = f.db.sqlite.prepare("SELECT csv_text, downloaded_at FROM issued_batches WHERE id = ?").get(issued.batch.id);
    expect(stored?.csv_text).toBeNull();
    expect(stored?.downloaded_at).toEqual(expect.any(String));
  });

  it("过期/撤销/重复领取链接失效，批次列表与概览状态正确", async () => {
    const f = fixture();
    const admin = await setup(f);
    const pending = await issue(f, admin, "pending,pending@example.test,Pending,specified-password-123");
    const downloaded = await issue(f, admin, "downloaded,downloaded@example.test,Downloaded,specified-password-123");
    const expired = await issue(f, admin, "expired,expired@example.test,Expired,specified-password-123");
    const revoked = await issue(f, admin, "revoked,revoked@example.test,Revoked,specified-password-123");
    expect((await download(f, downloaded.download_url)).status).toBe(200);
    f.db.sqlite.prepare("UPDATE issued_batches SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", expired.batch.id);
    expect((await download(f, expired.download_url)).status).toBe(404);
    expect((await f.call(`/api/v1/admin/accounts/batches/${revoked.batch.id}`, undefined, admin, "DELETE")).status).toBe(200);
    expect((await download(f, revoked.download_url)).status).toBe(404);
    expect(f.db.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = ?").get(revoked.batch.id)?.csv_text).toBeNull();
    expect((await f.call(`/api/v1/admin/accounts/batches/${revoked.batch.id}`, undefined, admin, "DELETE")).status).toBe(409);
    expect((await f.call(`/api/v1/admin/accounts/batches/${downloaded.batch.id}`, undefined, admin, "DELETE")).status).toBe(409);
    expect((await f.call(`/api/v1/admin/accounts/batches/${expired.batch.id}`, undefined, admin, "DELETE")).status).toBe(409);
    expect((await f.call("/api/v1/admin/accounts/batches/bat_missing", undefined, admin, "DELETE")).status).toBe(404);

    const list = await json<{ batches: IssuedBatch[]; total: number; limit: number; offset: number }>(
      await f.call("/api/v1/admin/accounts/batches?limit=2&offset=2", undefined, admin),
    );
    expect(list).toMatchObject({ total: 4, limit: 2, offset: 2 });
    expect(list.batches).toHaveLength(2);
    const all = await json<{ batches: IssuedBatch[] }>(await f.call("/api/v1/admin/accounts/batches?limit=10", undefined, admin));
    expect(Object.fromEntries(all.batches.map((batch) => [batch.id, batch.status]))).toEqual({
      [pending.batch.id]: "pending",
      [downloaded.batch.id]: "downloaded",
      [expired.batch.id]: "expired",
      [revoked.batch.id]: "revoked",
    });
    expect(JSON.stringify(all)).not.toContain("csv_text");
    expect(JSON.stringify(all)).not.toContain("download_token_hash");
    expect(f.db.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = ?").get(expired.batch.id)?.csv_text).toBeNull();

    const overview = await json<{
      accounts: { total: number }; teachers: { total: number }; batches: Record<string, number>; recent_batches: IssuedBatch[];
    }>(await f.call("/api/v1/admin/overview", undefined, admin));
    expect(overview.accounts.total).toBe(4);
    expect(overview.teachers.total).toBe(0);
    expect(overview.batches).toEqual({ pending: 1, downloaded: 1, expired: 1, revoked: 1 });
    expect(overview.recent_batches).toHaveLength(4);
  });
});

describe("M6.1 管理 API · 学生账号", () => {
  it("支持搜索、状态/密码状态筛选与分页，管理员可管理全部角色", async () => {
    const f = fixture();
    const admin = await setup(f);
    await issue(f, admin, [
      "learner.one,alice@example.test,Alice,alice-password-123",
      "bob,bob@example.test,Bob,bob-password-123",
      "carol,carol@example.test,Carol,carol-password-123",
    ].join("\n"));
    const aliceLogin = await f.call("/api/v1/auth/login", { identifier: "LEARNER.ONE", password: "alice-password-123" });
    const aliceCookie = aliceLogin.headers.get("set-cookie")!.split(";")[0]!;
    expect((await f.call("/api/v1/auth/password", {
      current_password: "alice-password-123", new_password: "alice-ready-password-123",
    }, aliceCookie)).status).toBe(200);

    const all = await json<{ accounts: AdminAccount[]; total: number }>(await f.call("/api/v1/admin/accounts", undefined, admin));
    expect(all.total).toBe(4);
    expect(all.accounts.map((account) => account.username).sort()).toEqual(["admin", "bob", "carol", "learner.one"]);
    expect(all.accounts.map((account) => account.email).sort()).toEqual(["admin@example.test", "alice@example.test", "bob@example.test", "carol@example.test"]);
    expect(all.accounts.filter((account) => account.role === "student").every((account) => account.batch_id && account.batch_filename === "codequest-accounts.csv")).toBe(true);
    expect(all.accounts.map((account) => account.role).sort()).toEqual(["admin", "student", "student", "student"]);
    expect(all.accounts.every((account) => !("password_hash" in account) && !("auth_version" in account))).toBe(true);

    const search = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?query=LEARNER", undefined, admin),
    );
    expect(search.total).toBe(1);
    expect(search.accounts[0]).toMatchObject({ username: "learner.one", email: "alice@example.test" });
    const emailSearch = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?query=ALICE@EXAMPLE", undefined, admin),
    );
    expect(emailSearch.accounts.map((account) => account.id)).toEqual([search.accounts[0]!.id]);
    const ready = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?password_state=ready", undefined, admin),
    );
    expect(ready.total).toBe(2);
    expect(ready.accounts.find((account) => account.username === "learner.one")?.must_change_password).toBe(false);
    expect(ready.accounts.find((account) => account.username === "admin")?.must_change_password).toBe(false);
    const required = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?password_state=required", undefined, admin),
    );
    expect(required.total).toBe(2);
    const page = await json<{ accounts: AdminAccount[]; total: number; limit: number; offset: number }>(
      await f.call("/api/v1/admin/accounts?limit=1&offset=1", undefined, admin),
    );
    expect(page).toMatchObject({ total: 4, limit: 1, offset: 1 });
    expect(page.accounts).toHaveLength(1);

    const accounts = all.accounts;
    const alice = accounts.find((account) => account.email === "alice@example.test")!;
    const bob = accounts.find((account) => account.email === "bob@example.test")!;
    const renamed = await f.call(`/api/v1/admin/accounts/${alice.id}`, { display_name: "Alice Updated" }, admin, "PATCH");
    expect(renamed.status).toBe(200);
    expect((await json<{ account: AdminAccount }>(renamed)).account.display_name).toBe("Alice Updated");
    const byDisplay = await json<{ accounts: AdminAccount[] }>(
      await f.call("/api/v1/admin/accounts?query=Updated", undefined, admin),
    );
    expect(byDisplay.accounts.map((account) => account.id)).toEqual([alice.id]);

    const identityPatch = await f.call(`/api/v1/admin/accounts/${alice.id}`, {
      username: " Alice.Updated ", email: " ALICE.UPDATED@EXAMPLE.TEST ",
    }, admin, "PATCH");
    expect(identityPatch.status).toBe(200);
    expect((await json<{ account: AdminAccount }>(identityPatch)).account)
      .toMatchObject({ username: "alice.updated", email: "alice.updated@example.test" });
    expect((await f.call(`/api/v1/admin/accounts/${alice.id}`, { username: bob.username }, admin, "PATCH")).status).toBe(409);
    expect((await f.call(`/api/v1/admin/accounts/${alice.id}`, { email: bob.email }, admin, "PATCH")).status).toBe(409);
    expect((await f.call("/api/v1/auth/login", {
      identifier: "ALICE.UPDATED", password: "alice-ready-password-123",
    })).status).toBe(200);
    expect((await f.call("/api/v1/auth/login", {
      identifier: "ALICE.UPDATED@EXAMPLE.TEST", password: "alice-ready-password-123",
    })).status).toBe(200);
    const byNewEmail = await json<{ accounts: AdminAccount[] }>(
      await f.call("/api/v1/admin/accounts?query=updated@example", undefined, admin),
    );
    expect(byNewEmail.accounts.map((account) => account.id)).toEqual([alice.id]);
    const clearedEmail = await f.call(`/api/v1/admin/accounts/${alice.id}`, { email: null }, admin, "PATCH");
    expect(clearedEmail.status).toBe(200);
    expect((await json<{ account: AdminAccount }>(clearedEmail)).account.email).toBeNull();
    expect((await f.call("/api/v1/auth/login", {
      identifier: "alice.updated@example.test", password: "alice-ready-password-123",
    })).status).toBe(401);

    const bobLogin = await f.call("/api/v1/auth/login", { identifier: "bob@example.test", password: "bob-password-123" });
    const bobCookie = bobLogin.headers.get("set-cookie")!.split(";")[0]!;
    expect((await f.call(`/api/v1/admin/accounts/${bob.id}`, { status: "disabled" }, admin, "PATCH")).status).toBe(200);
    expect((await f.call("/api/v1/auth/me", undefined, bobCookie)).status).toBe(401);
    expect((await f.call("/api/v1/auth/login", { identifier: "bob@example.test", password: "bob-password-123" })).status).toBe(403);
    const disabled = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?status=disabled", undefined, admin),
    );
    expect(disabled.total).toBe(1);
    expect(disabled.accounts[0]?.id).toBe(bob.id);
    expect((await f.call(`/api/v1/admin/accounts/${bob.id}`, { status: "active" }, admin, "PATCH")).status).toBe(200);
    expect((await f.call("/api/v1/auth/me", undefined, bobCookie)).status).toBe(401);
    expect((await f.call("/api/v1/auth/login", { identifier: "bob@example.test", password: "bob-password-123" })).status).toBe(200);

    const adminUser = f.db.sqlite.prepare("SELECT id FROM users WHERE role = 'admin'").get()!;
    const blockedDisable = await f.call(`/api/v1/admin/accounts/${adminUser.id}`, { status: "disabled" }, admin, "PATCH");
    expect(blockedDisable.status).toBe(409);
    expect(await json<{ error: { code: string } }>(blockedDisable)).toMatchObject({ error: { code: "LAST_ACTIVE_ADMIN" } });
    expect(f.db.sqlite.prepare("SELECT status FROM users WHERE id = ?").get(adminUser.id)?.status).toBe("active");
    expect((await f.call("/api/v1/auth/me", undefined, admin)).status).toBe(200);
    for (const query of ["limit=0", "limit=101", "offset=-1", "role=bogus", "status=bogus", "password_state=bogus"]) {
      expect((await f.call(`/api/v1/admin/accounts?${query}`, undefined, admin)).status).toBe(400);
    }
    const audited = f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_events WHERE action = 'account_updated'").get();
    expect(audited?.n).toBe(5);
  });

  it("乱码显示名不会出现在账号列表与登录信息中", async () => {
    const f = fixture();
    const admin = await setup(f);
    await issue(f, admin, "corrupt,corrupt@example.test,占位,corrupt-password-123");
    // 模拟历史数据中已经写入的编码损坏显示名。
    f.db.sqlite.prepare("UPDATE users SET display_name = '?????' WHERE username = 'corrupt'").run();

    const accounts = await json<{ accounts: AdminAccount[] }>(
      await f.call("/api/v1/admin/accounts", undefined, admin),
    );
    expect(accounts.accounts.find((account) => account.username === "corrupt")?.display_name).toBeNull();

    const login = await f.call("/api/v1/auth/login", {
      identifier: "corrupt", password: "corrupt-password-123",
    });
    expect(login.status).toBe(200);
    expect(await json<{ user: { username: string; display_name: string | null } }>(login))
      .toMatchObject({ user: { username: "corrupt", display_name: null } });

    // 新导入的 CSV 中如果仍有占位显示名，直接回退到用户名。
    await issue(f, admin, "fallback,fallback@example.test,?????,fallback-password-123");
    const refreshed = await json<{ accounts: AdminAccount[] }>(
      await f.call("/api/v1/admin/accounts?query=fallback", undefined, admin),
    );
    expect(refreshed.accounts[0]?.display_name).toBe("fallback");
  });

  it("管理员可管理教师，角色变更撤销会话并记录审计", async () => {
    const f = fixture();
    const admin = await setup(f);
    const password = "role-change-password-123";
    await issue(f, admin, `role-change,role-change@example.test,Role Change,${password}`);
    const account = (await json<{ accounts: AdminAccount[] }>(
      await f.call("/api/v1/admin/accounts?role=student", undefined, admin),
    )).accounts[0]!;
    const studentLogin = await f.call("/api/v1/auth/login", { identifier: account.email, password });
    const studentCookie = studentLogin.headers.get("set-cookie")!.split(";")[0]!;

    const promoted = await f.call(`/api/v1/admin/accounts/${account.id}`, { role: "teacher" }, admin, "PATCH");
    expect(promoted.status).toBe(200);
    expect((await json<{ account: AdminAccount }>(promoted)).account.role).toBe("teacher");
    expect((await f.call("/api/v1/auth/me", undefined, studentCookie)).status).toBe(401);
    const teacherLogin = await f.call("/api/v1/auth/login", { identifier: account.email, password });
    expect(teacherLogin.status).toBe(200);
    expect(await json<{ user: { role: UserRole } }>(teacherLogin)).toMatchObject({ user: { role: "teacher" } });
    const temporaryTeacherCookie = teacherLogin.headers.get("set-cookie")!.split(";")[0]!;
    expect((await f.call("/api/v1/auth/password", {
      current_password: password, new_password: "teacher-ready-password-123",
    }, temporaryTeacherCookie)).status).toBe(200);
    const readyTeacherLogin = await f.call("/api/v1/auth/login", { identifier: account.email, password: "teacher-ready-password-123" });
    const teacherCookie = readyTeacherLogin.headers.get("set-cookie")!.split(";")[0]!;

    expect((await f.call(`/api/v1/admin/accounts/${account.id}`, { status: "disabled" }, admin, "PATCH")).status).toBe(200);
    expect((await f.call("/api/v1/auth/me", undefined, teacherCookie)).status).toBe(401);
    expect((await f.call("/api/v1/auth/login", { identifier: account.email, password: "teacher-ready-password-123" })).status).toBe(403);
    expect((await f.call(`/api/v1/admin/accounts/${account.id}`, { status: "active" }, admin, "PATCH")).status).toBe(200);
    const reset = await f.call(`/api/v1/admin/accounts/${account.id}/password-reset`, undefined, admin, "POST");
    expect(reset.status).toBe(200);
    const temporaryPassword = (await json<{ temporary_password: string }>(reset)).temporary_password;
    const resetTeacherLogin = await f.call("/api/v1/auth/login", { identifier: account.email, password: temporaryPassword });
    expect(resetTeacherLogin.status).toBe(200);
    expect(await json<{ user: { role: UserRole }; must_change_password: boolean }>(resetTeacherLogin))
      .toMatchObject({ user: { role: "teacher" }, must_change_password: true });
    const resetTeacherCookie = resetTeacherLogin.headers.get("set-cookie")!.split(";")[0]!;
    const teacherOverview = await json<{ teachers: Record<string, number> }>(
      await f.call("/api/v1/admin/overview", undefined, admin),
    );
    expect(teacherOverview.teachers).toEqual({ total: 1, active: 1, disabled: 0, password_change_required: 1 });

    const demoted = await f.call(`/api/v1/admin/accounts/${account.id}`, { role: "student" }, admin, "PATCH");
    expect(demoted.status).toBe(200);
    expect((await json<{ account: AdminAccount }>(demoted)).account.role).toBe("student");
    expect((await f.call("/api/v1/auth/me", undefined, resetTeacherCookie)).status).toBe(401);
    const studentAgain = await f.call("/api/v1/auth/login", { identifier: account.email, password: temporaryPassword });
    expect(await json<{ user: { role: UserRole } }>(studentAgain)).toMatchObject({ user: { role: "student" } });
    expect((await f.call("/api/v1/admin/config", undefined, studentAgain.headers.get("set-cookie")!.split(";")[0]!)).status).toBe(403);

    const teachers = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?role=teacher", undefined, admin),
    );
    const students = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?role=student", undefined, admin),
    );
    expect(teachers.total).toBe(0);
    expect(students.accounts.map((item) => item.id)).toEqual([account.id]);
    const audit = await json<{ events: AuditEvent[] }>(await f.call("/api/v1/admin/audit", undefined, admin));
    const roleAudits = audit.events.filter((event) => event.action === "account_updated" && event.metadata.role !== undefined);
    expect(roleAudits.map((event) => event.metadata.role).sort()).toEqual(["student", "teacher"]);
    expect(roleAudits.every((event) => event.target_id === account.id)).toBe(true);

    const adminUser = f.db.sqlite.prepare("SELECT id FROM users WHERE role = 'admin'").get()!;
    const blockedDemotion = await f.call(`/api/v1/admin/accounts/${adminUser.id}`, { role: "teacher" }, admin, "PATCH");
    expect(blockedDemotion.status).toBe(409);
    expect(await json<{ error: { code: string } }>(blockedDemotion)).toMatchObject({ error: { code: "LAST_ACTIVE_ADMIN" } });
    expect(f.db.sqlite.prepare("SELECT role FROM users WHERE id = ?").get(adminUser.id)?.role).toBe("admin");
  });

  it("管理员可按自己的用户名或邮箱搜索到管理员账号", async () => {
    const f = fixture();
    const admin = await setup(f);
    await issue(f, admin, "alice,alice@example.test,Alice,alice-password-123");

    for (const query of ["ADMIN", "admin@example.test", "ADMIN@EXAMPLE.TEST"]) {
      const response = await f.call(`/api/v1/admin/accounts?query=${encodeURIComponent(query)}`, undefined, admin);
      expect(response.status, query).toBe(200);
      expect(await json<{ accounts: AdminAccount[]; total: number }>(response), query)
        .toMatchObject({ total: 1, accounts: [{ username: "admin", email: "admin@example.test", role: "admin" }] });
    }
    const visible = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts", undefined, admin),
    );
    expect(visible.total).toBe(2);
    expect(visible.accounts.map((account) => account.username).sort()).toEqual(["admin", "alice"]);
  });

  it("管理员可查看、调整并重置其他管理员账号", async () => {
    const f = fixture();
    const admin = await setup(f);
    await issue(f, admin, "other-admin,other-admin@example.test,Other Admin,other-admin-password-123");
    const target = (await json<{ accounts: AdminAccount[] }>(
      await f.call("/api/v1/admin/accounts?role=student", undefined, admin),
    )).accounts[0]!;

    const promoted = await f.call(`/api/v1/admin/accounts/${target.id}`, { role: "admin" }, admin, "PATCH");
    expect(promoted.status).toBe(200);
    expect((await json<{ account: AdminAccount }>(promoted)).account.role).toBe("admin");

    const admins = await json<{ accounts: AdminAccount[]; total: number }>(
      await f.call("/api/v1/admin/accounts?role=admin", undefined, admin),
    );
    expect(admins.total).toBe(2);
    expect(admins.accounts.map((account) => account.id).sort()).toEqual([target.id, f.db.sqlite.prepare("SELECT id FROM users WHERE username = 'admin'").get()!.id].sort());

    const renamed = await f.call(`/api/v1/admin/accounts/${target.id}`, { display_name: "Other Admin Updated" }, admin, "PATCH");
    expect(renamed.status).toBe(200);
    expect((await f.call(`/api/v1/admin/accounts/${target.id}`, { status: "disabled" }, admin, "PATCH")).status).toBe(200);
    expect((await f.call(`/api/v1/admin/accounts/${target.id}`, { status: "active" }, admin, "PATCH")).status).toBe(200);
    const reset = await f.call(`/api/v1/admin/accounts/${target.id}/password-reset`, undefined, admin, "POST");
    expect(reset.status).toBe(200);
    const credentials = await json<{ temporary_password: string; must_change_password: boolean }>(reset);
    const login = await f.call("/api/v1/auth/login", { identifier: "other-admin@example.test", password: credentials.temporary_password });
    expect(login.status).toBe(200);
    expect(await json<{ user: { role: UserRole }; must_change_password: boolean }>(login))
      .toMatchObject({ user: { role: "admin" }, must_change_password: true });
    expect((await f.call(`/api/v1/admin/accounts/${target.id}`, { role: "teacher" }, admin, "PATCH")).status).toBe(200);
  });

  it("重置临时密码撤销全部会话且不改变启停状态，也不泄露到审计", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await issue(f, admin, "alice,alice@example.test,Alice,alice-password-123");
    const account = (await json<{ accounts: AdminAccount[] }>(await f.call("/api/v1/admin/accounts?role=student", undefined, admin))).accounts[0]!;
    const firstLogin = await f.call("/api/v1/auth/login", { identifier: "alice@example.test", password: "alice-password-123" });
    const secondLogin = await f.call("/api/v1/auth/login", { identifier: "alice@example.test", password: "alice-password-123" });
    const firstCookie = firstLogin.headers.get("set-cookie")!.split(";")[0]!;
    const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0]!;

    const reset = await f.call(`/api/v1/admin/accounts/${account.id}/password-reset`, undefined, admin, "POST");
    expect(reset.status).toBe(200);
    expect(reset.headers.get("cache-control")).toContain("no-store");
    const credentials = await json<{ temporary_password: string; must_change_password: boolean }>(reset);
    expect(Object.keys(credentials).sort()).toEqual(["must_change_password", "temporary_password"]);
    expect(credentials.temporary_password.length).toBeGreaterThanOrEqual(10);
    expect(credentials.must_change_password).toBe(true);
    expect((await f.call("/api/v1/auth/me", undefined, firstCookie)).status).toBe(401);
    expect((await f.call("/api/v1/auth/me", undefined, secondCookie)).status).toBe(401);
    expect((await f.call("/api/v1/auth/login", { identifier: "alice@example.test", password: "alice-password-123" })).status).toBe(401);
    const sessions = f.db.sqlite.prepare("SELECT revoked_at FROM user_sessions WHERE user_id = ?").all(account.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revoked_at !== null)).toBe(true);
    const newLogin = await f.call("/api/v1/auth/login", { identifier: "alice@example.test", password: credentials.temporary_password });
    expect(newLogin.status).toBe(200);
    expect((await json<{ must_change_password: boolean }>(newLogin)).must_change_password).toBe(true);
    const temporaryCookie = newLogin.headers.get("set-cookie")!.split(";")[0]!;
    for (const path of ["/api/v1/me", "/api/v1/auth/me"]) {
      const me = await f.call(path, undefined, temporaryCookie);
      expect(me.status).toBe(200);
      expect(await json<{ user: AdminAccount }>(me)).toMatchObject({
        user: { email: "alice@example.test", must_change_password: true },
      });
    }
    for (const path of ["/api/v1/courses", "/api/v1/admin/config", "/api/v1/admin/overview"]) {
      const blocked = await f.call(path, undefined, temporaryCookie);
      expect(blocked.status).toBe(403);
      expect(await json<{ error: { code: string } }>(blocked)).toMatchObject({
        error: { code: "PASSWORD_CHANGE_REQUIRED" },
      });
    }
    const stored = f.db.sqlite.prepare("SELECT status, must_change_password, password_updated_at FROM users WHERE id = ?").get(account.id);
    expect(stored).toMatchObject({ status: "active", must_change_password: 1 });
    expect(stored?.password_updated_at).toEqual(expect.any(String));

    await f.call(`/api/v1/admin/accounts/${account.id}`, { status: "disabled" }, admin, "PATCH");
    const disabledReset = await f.call(`/api/v1/admin/accounts/${account.id}/password-reset`, undefined, admin, "POST");
    const secondCredentials = await json<{ temporary_password: string }>(disabledReset);
    expect(f.db.sqlite.prepare("SELECT status FROM users WHERE id = ?").get(account.id)?.status).toBe("disabled");
    expect((await f.call("/api/v1/auth/login", {
      identifier: "alice@example.test", password: secondCredentials.temporary_password,
    })).status).toBe(403);

    const auditText = JSON.stringify(f.db.sqlite.prepare("SELECT * FROM admin_audit_events").all());
    expect(auditText).not.toContain(credentials.temporary_password);
    expect(auditText).not.toContain(secondCredentials.temporary_password);
    expect(count(f, "admin_audit_events")).toBe(4); // 发号、停用、两次重置；撤销链接不影响账号。
    expect(issued.batch.status).toBe("pending");
  });

  it("管理员不能通过成员管理重置自己的密码，且凭据、会话与审计均不变", async () => {
    const f = fixture();
    const admin = await setup(f);
    const adminUser = f.db.sqlite.prepare("SELECT id FROM users WHERE role = 'admin'").get()!;
    const adminBefore = f.db.sqlite.prepare(`
      SELECT password_hash, password_updated_at, must_change_password, auth_version, status
      FROM users WHERE id = ?
    `).get(adminUser.id);
    const sessionsBefore = f.db.sqlite.prepare("SELECT * FROM user_sessions WHERE user_id = ? ORDER BY id")
      .all(adminUser.id);
    const auditsBefore = f.db.sqlite.prepare("SELECT * FROM admin_audit_events ORDER BY id").all();
    expect(sessionsBefore).not.toHaveLength(0);

    const response = await f.call(`/api/v1/admin/accounts/${adminUser.id}/password-reset`, undefined, admin, "POST");
    expect(response.status).toBe(403);
    const error = await json<{ error: { code: string }; temporary_password?: string }>(response);
    expect(error).toMatchObject({ error: { code: "CANNOT_RESET_OWN_PASSWORD" } });
    expect(error).not.toHaveProperty("temporary_password");
    expect(f.db.sqlite.prepare(`
      SELECT password_hash, password_updated_at, must_change_password, auth_version, status
      FROM users WHERE id = ?
    `).get(adminUser.id)).toEqual(adminBefore);
    expect(f.db.sqlite.prepare("SELECT * FROM user_sessions WHERE user_id = ? ORDER BY id")
      .all(adminUser.id)).toEqual(sessionsBefore);
    expect(f.db.sqlite.prepare("SELECT * FROM admin_audit_events ORDER BY id").all()).toEqual(auditsBefore);
    expect((await f.call("/api/v1/auth/me", undefined, admin)).status).toBe(200);
  });

  it("管理员仍可通过 /api/v1/auth/password 自主改密", async () => {
    const f = fixture();
    const admin = await setup(f);
    const changed = await f.call("/api/v1/auth/password", {
      current_password: "admin-password-123", new_password: "admin-ready-password-123",
    }, admin);
    expect(changed.status).toBe(200);
    expect(await json(changed)).toEqual({ ok: true, reauth_required: true });
    expect((await f.call("/api/v1/auth/me", undefined, admin)).status).toBe(401);
    const relogin = await f.call("/api/v1/auth/login", {
      identifier: "admin@example.test", password: "admin-ready-password-123",
    });
    expect(relogin.status).toBe(200);
  });
});

describe("M6.1 管理 API · 审计与课程", () => {
  it("审计列表可分页并包含操作者，概览不返回凭据或 CSV", async () => {
    const f = fixture();
    const admin = await setup(f);
    const issued = await issue(f, admin, "alice,alice@example.test,Alice,specified-password-123");
    const account = (await json<{ accounts: AdminAccount[] }>(await f.call("/api/v1/admin/accounts?role=student", undefined, admin))).accounts[0]!;
    await f.call(`/api/v1/admin/accounts/${account.id}`, { display_name: "Alice Audited" }, admin, "PATCH");
    const reset = await f.call(`/api/v1/admin/accounts/${account.id}/password-reset`, undefined, admin, "POST");
    const temporaryPassword = (await json<{ temporary_password: string }>(reset)).temporary_password;
    await f.call(`/api/v1/admin/accounts/batches/${issued.batch.id}`, undefined, admin, "DELETE");
    expect((await f.call("/api/v1/admin/courses", { pack: demoPack }, admin)).status).toBe(201);

    const all = await json<{ events: AuditEvent[]; total: number; limit: number; offset: number }>(
      await f.call("/api/v1/admin/audit", undefined, admin),
    );
    expect(all).toMatchObject({ total: 5, limit: 20, offset: 0 });
    expect(all.events).toHaveLength(5);
    expect(all.events.map((event) => event.action).sort()).toEqual([
      "account_password_reset", "account_updated", "batch_created", "batch_revoked", "course_created",
    ]);
    expect(all.events.every((event) => event.actor_username === "admin" &&
      event.actor_email === "admin@example.test" && event.actor_id)).toBe(true);
    expect(all.events.every((event) => Object.keys(event).sort().join(",") ===
      "action,actor_email,actor_id,actor_username,created_at,id,metadata,target_id,target_type")).toBe(true);
    const page = await json<{ events: AuditEvent[]; total: number; limit: number; offset: number }>(
      await f.call("/api/v1/admin/audit?limit=2&offset=1", undefined, admin),
    );
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 1 });
    expect(page.events).toHaveLength(2);
    const auditText = JSON.stringify(all);
    expect(auditText).not.toContain("specified-password-123");
    expect(auditText).not.toContain(temporaryPassword);
    expect(auditText).not.toContain(issued.download_url.split("/").at(-1)!);
    expect(auditText).not.toContain("username,email,display_name,password");
    const overview = await json<{ recent_audit: AuditEvent[] }>(await f.call("/api/v1/admin/overview", undefined, admin));
    expect(overview.recent_audit).toHaveLength(5);
    expect(JSON.stringify(overview)).not.toContain(temporaryPassword);
    expect((await f.call("/api/v1/admin/audit?limit=0", undefined, admin)).status).toBe(400);
  });

  it("无邮箱管理员的公开审计保留用户名并返回 null 邮箱", async () => {
    const f = fixture();
    const admin = await setup(f, null);
    await issue(f, admin, "alice,alice@example.test,Alice,specified-password-123");
    const audit = await json<{ events: AuditEvent[] }>(await f.call("/api/v1/admin/audit", undefined, admin));
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ actor_username: "admin", actor_email: null, action: "batch_created" });
    expect(f.db.sqlite.prepare("SELECT actor_username, actor_email FROM admin_audit_events").get())
      .toEqual({ actor_username: "admin", actor_email: null });
  });

  it("课程列表返回管理字段，上传/上下架即时影响学员并记录审计", async () => {
    const f = fixture({ REGISTRATION_ENABLED: "true" });
    const admin = await setup(f);
    const student = await registerStudent(f, "student", "student-password-123", "student@example.test");
    expect((await f.call("/api/v1/admin/courses", { pack: { "course.json": "{}" } }, admin)).status).toBe(400);
    const oversized = { ...demoPack, "large.txt": "x".repeat(1_500_000) };
    const oversizedResponse = await f.call("/api/v1/admin/courses", { pack: oversized }, admin);
    expect(oversizedResponse.status).toBe(413);
    expect(await json<{ error: { code: string } }>(oversizedResponse)).toMatchObject({ error: { code: "PACK_TOO_LARGE" } });
    expect(count(f, "admin_audit_events")).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);

    const uploaded = await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    expect(uploaded.status).toBe(201);
    const course = (await json<{ course: {
      id: string; version: number; enabled: boolean; created_at: string; updated_at: string;
    } }>(uploaded)).course;
    expect(course).toMatchObject({ version: 1, enabled: true });
    expect(course.created_at).toEqual(expect.any(String));
    expect(course.updated_at).toEqual(expect.any(String));
    const adminList = await json<{ courses: Record<string, unknown>[] }>(await f.call("/api/v1/admin/courses", undefined, admin));
    expect(adminList.courses).toHaveLength(1);
    expect(adminList.courses[0]).toMatchObject({ id: course.id, enabled: true, version: 1 });
    expect(adminList.courses[0]).not.toHaveProperty("pack_json");

    const disabled = await f.call(`/api/v1/admin/courses/${course.id}`, { enabled: false }, admin, "PATCH");
    expect(disabled.status).toBe(200);
    expect((await json<{ course: { enabled: boolean } }>(disabled)).course.enabled).toBe(false);
    expect((await json<{ courses: unknown[] }>(await f.call("/api/v1/courses", undefined, student))).courses).toHaveLength(0);
    expect((await f.call(`/api/v1/courses/${course.id}/pack`, undefined, student)).status).toBe(404);
    const adminDisabled = await json<{ courses: { enabled: boolean }[] }>(await f.call("/api/v1/admin/courses", undefined, admin));
    expect(adminDisabled.courses[0]?.enabled).toBe(false);

    const replacement = structuredClone(demoPack);
    replacement["course.json"] = JSON.stringify({
      id: "demo", slug: "demo", title: "演示课程 v2", summary: "M6.1 验收",
      langs: ["javascript"], entry: "start.txt",
    });
    const reuploaded = await f.call("/api/v1/admin/courses", { pack: replacement }, admin);
    expect(reuploaded.status).toBe(201);
    const updated = (await json<{ course: { id: string; version: number; enabled: boolean; title: string } }>(reuploaded)).course;
    expect(updated).toMatchObject({ id: course.id, version: 2, enabled: true, title: "演示课程 v2" });
    // 管理端仍保留内容存储能力，但学习端课程接口当前固定返回空目录。
    expect((await json<{ courses: unknown[] }>(await f.call("/api/v1/courses", undefined, student))).courses).toHaveLength(0);
    expect((await f.call(`/api/v1/courses/${course.id}/pack`, undefined, student)).status).toBe(404);
    expect((await f.call("/api/v1/admin/courses/crs_missing", { enabled: false }, admin, "PATCH")).status).toBe(404);
    const audit = f.db.sqlite.prepare("SELECT action, metadata_json FROM admin_audit_events ORDER BY created_at, id").all();
    expect(audit.map((event) => event.action)).toEqual(["course_created", "course_updated", "course_updated"]);
    expect(audit.map((event) => JSON.parse(String(event.metadata_json)))).toEqual([
      { slug: "demo", version: 1 }, { enabled: false }, { slug: "demo", version: 2 },
    ]);
  });
});

describe("M6.1 管理 API · 过期凭证清理", () => {
  it("Cron 与概览读取都会清除过期 CSV，但保留未过期批次", async () => {
    const f = fixture();
    const admin = await setup(f);
    const expired = await issue(f, admin, "expired,expired@example.test,Expired,specified-password-123");
    const pending = await issue(f, admin, "pending,pending@example.test,Pending,specified-password-123");
    f.db.sqlite.prepare("UPDATE issued_batches SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", expired.batch.id);

    let cleanup: Promise<unknown> | undefined;
    await worker.scheduled({} as ScheduledController, f.env, {
      waitUntil(promise: Promise<unknown>) { cleanup = promise; },
      passThroughOnException() {},
    } as unknown as ExecutionContext);
    expect(cleanup).toBeDefined();
    await cleanup;
    expect(f.db.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = ?").get(expired.batch.id)?.csv_text).toBeNull();
    expect(f.db.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = ?").get(pending.batch.id)?.csv_text).not.toBeNull();

    const second = await issue(f, admin, "expired-again,expired-again@example.test,Expired Again,specified-password-123");
    f.db.sqlite.prepare("UPDATE issued_batches SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", second.batch.id);
    expect((await f.call("/api/v1/admin/overview", undefined, admin)).status).toBe(200);
    expect(f.db.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = ?").get(second.batch.id)?.csv_text).toBeNull();
  });
});

describe("M6.1 管理 API · 单一初始化迁移", () => {
  it("migrations 仅保留 0001 基线，并与 schema.sql 完全一致", () => {
    const root = new URL("../../migrations/", import.meta.url);
    expect(fs.readdirSync(root).filter((name) => name.endsWith(".sql"))).toEqual(["0001_init.sql"]);
    expect(fs.readFileSync(new URL("0001_init.sql", root), "utf8"))
      .toBe(fs.readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
  });

  it("用户角色约束仅允许 student、teacher、admin，拒绝 member", () => {
    const db = new SqliteD1();
    dbs.push(db);
    db.sqlite.exec(fs.readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
    const now = "2026-11-27T00:00:00.000Z";
    for (const role of ["student", "teacher", "admin"]) {
      db.sqlite.prepare("INSERT INTO users (id, username, email, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)")
        .run(`usr_${role}`, role, `${role}@example.test`, role, now);
    }
    expect(() => db.sqlite.prepare("INSERT INTO users (id, username, email, role, status, created_at) VALUES ('usr_member', 'member', 'member@example.test', 'member', 'active', ?)")
      .run(now)).toThrow();
    expect(db.sqlite.prepare("SELECT role FROM users ORDER BY role").all()).toEqual([
      { role: "admin" }, { role: "student" }, { role: "teacher" },
    ]);
  });

  it("用户名必填且唯一，邮箱可空且仅在非空时唯一", () => {
    const db = new SqliteD1();
    dbs.push(db);
    db.sqlite.exec(fs.readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
    const now = "2026-11-27T00:00:00.000Z";
    const insert = (id: string, username: string | null, email: string | null) => db.sqlite.prepare(
      "INSERT INTO users (id, username, email, role, status, created_at) VALUES (?1, ?2, ?3, 'student', 'active', ?4)",
    ).run(id, username, email, now);
    insert("usr_a", "alice", null);
    insert("usr_b", "bob", null);
    insert("usr_c", "carol", "shared@example.test");
    expect(() => insert("usr_duplicate_username", "alice", null)).toThrow(/users\.username/);
    expect(() => insert("usr_duplicate_email", "dave", "shared@example.test")).toThrow(/users\.email/);
    expect(() => insert("usr_missing_username", null, null)).toThrow(/username/);
  });

  it("0001 基线包含最终批次结构，并保留一次性领取后清空明文的触发器", () => {
    const baseline = new SqliteD1();
    dbs.push(baseline);
    baseline.sqlite.exec(fs.readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
    const createdAt = "2999-11-20T12:34:56.789Z";
    baseline.sqlite.prepare(`INSERT INTO users (id, username, email, role, status, created_at)
      VALUES ('usr_admin', 'admin', 'admin@example.test', 'admin', 'active', ?)`).run(createdAt);
    baseline.sqlite.prepare(`INSERT INTO issued_batches
      (id, admin_id, filename, count, download_token_hash, csv_text, expires_at, downloaded_at, revoked_at, created_at)
      VALUES ('bat_pending', 'usr_admin', 'accounts.csv', 1, 'hash-pending', 'username,email,display_name,password', ?, NULL, NULL, ?)`)
      .run("2999-11-21T12:34:56.789Z", createdAt);

    const columns = baseline.sqlite.prepare("PRAGMA table_info(issued_batches)").all();
    expect(columns.find((column) => column.name === "role")?.notnull).toBe(1);
    expect(baseline.sqlite.prepare("SELECT role FROM issued_batches WHERE id = 'bat_pending'").get()?.role).toBe("student");
    expect(columns.find((column) => column.name === "csv_text")?.notnull).toBe(0);
    expect(columns.some((column) => column.name === "expires_at" && column.notnull === 1)).toBe(true);
    expect(columns.some((column) => column.name === "revoked_at")).toBe(true);
    expect(baseline.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user_issuance','admin_audit_events','freeform_drafts')").all()).toHaveLength(3);
    expect(baseline.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'issued_batches_clear_csv_after_download'").get()).toBeDefined();

    const returned = baseline.sqlite.prepare(`UPDATE issued_batches SET downloaded_at = ?
      WHERE id = 'bat_pending' RETURNING csv_text`).get("2999-11-21T00:00:00.000Z");
    expect(returned?.csv_text).toBe("username,email,display_name,password");
    expect(baseline.sqlite.prepare("SELECT csv_text FROM issued_batches WHERE id = 'bat_pending'").get()?.csv_text).toBeNull();
  });
});
