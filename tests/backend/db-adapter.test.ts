import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/db";
import { applyAllMigrations, builtin, SqliteD1 } from "../helpers/sqlite-d1";

const fs = builtin<{
  readFileSync(path: URL, encoding: string): string;
  readdirSync(path: URL, options?: { withFileTypes: boolean }): Array<{ name: string; isDirectory(): boolean }>;
}>("node:fs");

const dbs: SqliteD1[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close(); });

function fixture() {
  const sqlite = new SqliteD1();
  dbs.push(sqlite);
  applyAllMigrations(sqlite);
  return { sqlite, db: createDatabase(sqlite.asD1()) };
}

describe("数据库层抽象", () => {
  it("业务层通过 Database 契约执行查询、写入与批量事务", async () => {
    const { db } = fixture();
    const inserted = await db.prepare("INSERT INTO instance_settings (k, v) VALUES (?1, ?2)")
      .bind("instance_name", "抽象测试").run();
    expect(inserted).toEqual({ changes: 1 });

    const first = await db.prepare("SELECT v FROM instance_settings WHERE k = ?1")
      .bind("instance_name").first<{ v: string }>();
    expect(first).toEqual({ v: "抽象测试" });

    const all = await db.prepare("SELECT k, v FROM instance_settings").all<{ k: string; v: string }>();
    expect(all.results).toEqual([{ k: "instance_name", v: "抽象测试" }]);

    const batch = await db.batch([
      db.prepare("INSERT INTO instance_settings (k, v) VALUES (?1, ?2)").bind("a", "1"),
      db.prepare("INSERT INTO instance_settings (k, v) VALUES (?1, ?2)").bind("b", "2"),
      db.prepare("UPDATE instance_settings SET v = ?1 WHERE k = ?2").bind("3", "b"),
    ]);
    expect(batch.map((result) => result.changes)).toEqual([1, 1, 1]);
    expect((await db.prepare("SELECT v FROM instance_settings WHERE k = 'b'").first<{ v: string }>())?.v).toBe("3");
  });

  it("路由与服务不直接依赖 D1 类型，只有适配器读取 env.DB", () => {
    const files: string[] = [];
    const walk = (path: URL) => {
      for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(new URL(entry.name + "/", path));
        else if (entry.name.endsWith(".ts")) files.push(fs.readFileSync(new URL(entry.name, path), "utf8"));
      }
    };
    walk(new URL("../../src/routes/", import.meta.url));
    walk(new URL("../../src/lib/", import.meta.url));
    for (const source of files) {
      expect(source).not.toContain("c.env.DB");
      expect(source).not.toMatch(/\bD1Database\b/);
      expect(source).not.toMatch(/\bD1PreparedStatement\b/);
    }
  });
});
