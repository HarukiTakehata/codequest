import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import { readCoursePack } from "../../src/lib/course";
import { getCourseProvider } from "../../src/lib/course-provider";
import type { CourseRow, Env } from "../../src/types";
import { applyAllMigrations, builtin, SqliteD1 } from "../helpers/sqlite-d1";
import { MemoryR2 } from "../helpers/memory-r2";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

const demoPack = {
  "course.json": JSON.stringify({
    id: "storage", slug: "storage", title: "课程存储", langs: ["javascript"], entry: "start.txt",
  }),
  "start.txt": "say:导师:R2 主存储;end;",
};

function fixture(r2?: MemoryR2) {
  const db = new SqliteD1();
  dbs.push(db);
  applyAllMigrations(db);
  const env = {
    DB: db.asD1(), TOKEN_PEPPER: "test-pepper", ENVIRONMENT: "test",
    ...(r2 ? { COURSE_PACKS: r2.asR2() } : {}),
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

async function setup(f: ReturnType<typeof fixture>) {
  const response = await f.call("/api/v1/setup", {
    instance_name: "存储测试", admin: { username: "admin", email: "admin@example.test", password: "admin-password-123" },
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function upload(f: ReturnType<typeof fixture>, admin: string, pack = demoPack) {
  const response = await f.call("/api/v1/admin/courses", { pack }, admin);
  expect(response.status).toBe(201);
  return (await response.json() as { course: { id: string; version: number } }).course;
}

function storedCourse(f: ReturnType<typeof fixture>): CourseRow {
  return f.db.sqlite.prepare("SELECT * FROM courses").get() as unknown as CourseRow;
}

describe("学习端课程 provider", () => {
  it("默认 provider 固定无课，路由不直接绑定 WebGAL 或课程包存储", async () => {
    const provider = getCourseProvider({} as Env);
    expect(await provider.list()).toEqual([]);
    expect(await provider.get("any")).toBeNull();
    expect(await provider.pack("any")).toBeNull();
    expect(await provider.file("any", "start.txt")).toBeNull();

    const route = fs.readFileSync(new URL("../../src/routes/courses.ts", import.meta.url), "utf8");
    expect(route).toContain("getCourseProvider");
    expect(route).not.toContain('from "../lib/course";');
    expect(route).not.toMatch(/WebGAL|readCoursePack|CourseRow/);
  });
});

describe("课程包 R2 主存储与 D1 回读", () => {
  it("R2 写入版本化对象，D1 只存元数据，整包与单文件均从 R2 读取", async () => {
    const r2 = new MemoryR2();
    const f = fixture(r2);
    const admin = await setup(f);
    const first = await upload(f, admin);
    const firstRow = storedCourse(f);

    expect(firstRow.pack_json).toBeNull();
    expect(firstRow.pack_key).toMatch(/^courses\/crs_[^/]+\/1\/upl_[^/]+\.json$/);
    expect(r2.objects.get(firstRow.pack_key)?.body).toBe(JSON.stringify(demoPack));
    expect(r2.puts).toEqual([firstRow.pack_key]);

    // 学习端路由当前固定返回空课程；这里直接验证底层存储契约仍可复用。
    expect(await readCoursePack(f.env, firstRow)).toEqual(demoPack);
    expect((await readCoursePack(f.env, firstRow))["start.txt"]).toBe(demoPack["start.txt"]);
    expect(r2.gets).toEqual([firstRow.pack_key, firstRow.pack_key]);

    const replacement = structuredClone(demoPack);
    replacement["course.json"] = JSON.stringify({
      id: "storage", slug: "storage", title: "课程存储 v2", langs: ["javascript"], entry: "start.txt",
    });
    const second = await upload(f, admin, replacement);
    const secondRow = storedCourse(f);
    expect(second).toMatchObject({ id: first.id, version: 2 });
    expect(secondRow.pack_json).toBeNull();
    expect(secondRow.pack_key).toMatch(new RegExp(`^courses/${first.id}/2/upl_[^/]+\\.json$`));
    expect(r2.objects.size).toBe(2);
    expect(r2.objects.get(firstRow.pack_key)?.body).toBe(JSON.stringify(demoPack));
    expect(r2.objects.get(secondRow.pack_key)?.body).toBe(JSON.stringify(replacement));

    r2.objects.delete(secondRow.pack_key);
    await expect(readCoursePack(f.env, secondRow)).rejects.toMatchObject({
      status: 503, code: "COURSE_PACK_UNAVAILABLE",
    });
  });

  it("未配置 R2 时只读 D1；配置 R2 后对象缺失不再回读 D1", async () => {
    const f = fixture();
    const admin = await setup(f);
    await upload(f, admin);
    const localRow = storedCourse(f);
    expect(localRow.pack_json).toBe(JSON.stringify(demoPack));
    expect(await readCoursePack(f.env, localRow)).toEqual(demoPack);

    const r2 = new MemoryR2();
    f.env.COURSE_PACKS = r2.asR2();
    await expect(readCoursePack(f.env, localRow)).rejects.toMatchObject({
      status: 503, code: "COURSE_PACK_UNAVAILABLE",
    });
    expect(r2.gets).toEqual([localRow.pack_key]);

    r2.objects.set(localRow.pack_key, { body: JSON.stringify(demoPack) });
    expect(await readCoursePack(f.env, localRow)).toEqual(demoPack);

    r2.getError = new Error("R2 read unavailable");
    await expect(readCoursePack(f.env, localRow)).rejects.toMatchObject({
      status: 503, code: "COURSE_PACK_UNAVAILABLE",
    });
  });

  it("R2 写入失败时不修改 D1 或管理审计", async () => {
    const r2 = new MemoryR2();
    r2.putError = new Error("R2 unavailable");
    const f = fixture(r2);
    const admin = await setup(f);
    const response = await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "COURSE_PACK_WRITE_FAILED" } });
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_events").get()?.n).toBe(0);
  });

  it("R2 写入后 D1 失败会删除新对象，不留下半版本课程", async () => {
    const r2 = new MemoryR2();
    const f = fixture(r2);
    const admin = await setup(f);
    f.db.sqlite.exec(`CREATE TRIGGER fail_course_insert BEFORE INSERT ON courses
      BEGIN SELECT RAISE(ABORT, 'forced course failure'); END;`);
    const response = await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    expect(response.status).toBe(500);
    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0]).toMatch(/^courses\/crs_[^/]+\/1\/upl_[^/]+\.json$/);
    expect(r2.deletes).toEqual(r2.puts);
    expect(r2.objects.size).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_events").get()?.n).toBe(0);
  });

  it("更新时 R2 失败保留旧版本，D1 失败只清理新 key 且保留旧行", async () => {
    const r2 = new MemoryR2();
    const f = fixture(r2);
    const admin = await setup(f);
    await upload(f, admin);
    const firstRow = storedCourse(f);
    const replacement = structuredClone(demoPack);
    replacement["course.json"] = JSON.stringify({
      id: "storage", slug: "storage", title: "课程存储 v2", langs: ["javascript"], entry: "start.txt",
    });

    r2.putError = new Error("R2 unavailable");
    const putFailure = await f.call("/api/v1/admin/courses", { pack: replacement }, admin);
    expect(putFailure.status).toBe(503);
    expect(storedCourse(f)).toMatchObject({ version: 1, pack_key: firstRow.pack_key });
    expect(await readCoursePack(f.env, firstRow)).toEqual(demoPack);

    r2.putError = null;
    f.db.sqlite.exec(`CREATE TRIGGER fail_course_update BEFORE UPDATE ON courses
      BEGIN SELECT RAISE(ABORT, 'forced course update failure'); END;`);
    const updateFailure = await f.call("/api/v1/admin/courses", { pack: replacement }, admin);
    expect(updateFailure.status).toBe(500);
    expect(storedCourse(f)).toMatchObject({ version: 1, pack_key: firstRow.pack_key });
    expect(r2.objects.size).toBe(1);
    expect(r2.objects.has(firstRow.pack_key)).toBe(true);
    expect(r2.puts).toHaveLength(2);
    expect(r2.deletes).toEqual([r2.puts[1]]);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_events").get()?.n).toBe(1);
  });

  it("管理审计与课程元数据同批提交，审计失败时课程和 R2 均回滚", async () => {
    const r2 = new MemoryR2();
    const f = fixture(r2);
    const admin = await setup(f);
    f.db.sqlite.exec(`CREATE TRIGGER fail_admin_audit BEFORE INSERT ON admin_audit_events
      BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;`);
    const response = await f.call("/api/v1/admin/courses", { pack: demoPack }, admin);
    expect(response.status).toBe(500);
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM courses").get()?.n).toBe(0);
    expect(r2.objects.size).toBe(0);
    expect(r2.deletes).toEqual(r2.puts);
  });

  it("同 slug 并发上传使用唯一 key 和版本 CAS，最终 D1 指向匹配正文", async () => {
    const r2 = new MemoryR2();
    const f = fixture(r2);
    const admin = await setup(f);
    const makePack = (title: string) => ({
      ...demoPack,
      "course.json": JSON.stringify({ id: "storage", slug: "storage", title, entry: "start.txt" }),
    });
    const responses = await Promise.all([
      f.call("/api/v1/admin/courses", { pack: makePack("并发 A") }, admin),
      f.call("/api/v1/admin/courses", { pack: makePack("并发 B") }, admin),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const versions = await Promise.all(responses.map(async (response) =>
      (await response.json() as { course: { version: number } }).course.version));
    expect(versions.sort()).toEqual([1, 2]);
    const row = storedCourse(f);
    expect(row.version).toBe(2);
    expect(r2.puts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(r2.puts).size).toBe(r2.puts.length);
    expect(r2.objects.size).toBe(2);
    expect(r2.deletes).toHaveLength(r2.puts.length - 2);
    expect(r2.objects.get(row.pack_key)?.body).toBe(JSON.stringify(makePack(row.title)));
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_events").get()?.n).toBe(2);
  });

  it("0001 基线直接支持可空 pack_json 与 progress 外键", () => {
    const db = new SqliteD1();
    dbs.push(db);
    db.sqlite.exec(fs.readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
    const now = "2026-11-27T00:00:00.000Z";
    db.sqlite.prepare(`INSERT INTO users (id, username, email, role, status, created_at)
      VALUES ('usr_admin', 'admin', 'admin@example.test', 'admin', 'active', ?)`).run(now);
    db.sqlite.prepare(`INSERT INTO courses
      (id, slug, title, version, pack_json, pack_key, bytes, sha256, created_by, created_at, updated_at)
      VALUES ('crs_r2', 'r2', 'R2 课程', 1, NULL, 'courses/r2/1/pack.json', 10, 'hash', 'usr_admin', ?, ?)`)
      .run(now, now);
    db.sqlite.prepare(`INSERT INTO progress (user_id, course_id, data_json, updated_at)
      VALUES ('usr_admin', 'crs_r2', '{}', ?)`).run(now);

    const row = db.sqlite.prepare("SELECT pack_json FROM courses WHERE id = 'crs_r2'").get();
    expect(row?.pack_json).toBeNull();
    const columns = db.sqlite.prepare("PRAGMA table_info(courses)").all();
    expect(columns.find((column) => column.name === "pack_json")?.notnull).toBe(0);
    expect(columns.some((column) => column.name === "legacy_pack_json")).toBe(false);
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.sqlite.prepare("SELECT course_id FROM progress").get()?.course_id).toBe("crs_r2");
    expect(() => db.sqlite.prepare(`INSERT INTO courses
      (id, slug, title, pack_json, pack_key, bytes, sha256, created_at, updated_at)
      VALUES ('crs_d1', 'd1', 'D1 课程', ?, 'courses/d1/1/pack.json', 10, 'hash', ?, ?)`)
      .run(JSON.stringify(demoPack), now, now)).not.toThrow();
  });
});
