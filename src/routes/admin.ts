import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { parseRoster, rosterToCsv } from "../lib/csv";
import { publicCourse, saveCoursePack } from "../lib/course";
import { sha256Hex } from "../lib/crypto";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { newId } from "../lib/ids";
import { hashPassword, temporaryPassword, validatePassword } from "../lib/password";
import { nowIso } from "../lib/time";
import { requireAdmin, requireUser } from "../middleware/identity";
import type { CourseRow } from "../types";

export const adminRoutes = new Hono<AppEnv>();
// 一次性发放链接本身即凭据，无需会话 Cookie；其余管理接口需管理员会话。
const isDownloadLink = (path: string) => path.includes("/accounts/download/");
adminRoutes.use("*", async (c, next) => {
  if (isDownloadLink(c.req.path)) return next();
  await requireUser(c, next);
});
adminRoutes.use("*", async (c, next) => {
  if (isDownloadLink(c.req.path)) return next();
  await requireAdmin(c, next);
});

/**
 * 供 nginx `auth_request` 校验管理员会话（独立子域部署的编辑器使用）。
 * 204 = 放行；401 / 403 = 拒绝，由 nginx 直接返回给浏览器。
 */
adminRoutes.get("/check", (c) => c.body(null, 204));

const batchSchema = z.object({ csv: z.string().min(1).max(200_000), filename: z.string().max(120).optional() });
const packSchema = z.object({ pack: z.record(z.string()) });

/** 批量发号：CSV → 建号（初始密码强制修改）→ 一次性下载链接发放表。 */
adminRoutes.post("/accounts/batch", async (c) => {
  const body = await parseBody(c, batchSchema);
  const roster = parseRoster(body.csv);
  if (!roster.length) throw new HttpError(400, "INVALID_ARGUMENT", "CSV 中没有合法账号");
  if (roster.length > 500) throw new HttpError(400, "INVALID_ARGUMENT", "单次最多 500 个账号");
  const seen = new Set<string>();
  for (const row of roster) {
    if (seen.has(row.email)) throw new HttpError(400, "INVALID_ARGUMENT", `CSV 中邮箱重复: ${row.email}`);
    seen.add(row.email);
    if (row.password) {
      const error = validatePassword(row.password);
      if (error) throw new HttpError(400, "INVALID_ARGUMENT", `${row.email}: ${error}`);
    }
  }

  const now = nowIso();
  const accounts: { email: string; display_name: string; password: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const row of roster) {
    const password = row.password ?? temporaryPassword();
    accounts.push({ email: row.email, display_name: row.display_name, password });
    statements.push(c.env.DB.prepare(`INSERT INTO users
      (id, email, display_name, role, status, password_hash, password_updated_at, must_change_password, auth_version, last_seen_at, created_at)
      VALUES (?1, ?2, ?3, 'member', 'active', ?4, ?5, 1, 1, NULL, ?6)`)
      .bind(newId("usr"), row.email, row.display_name, await hashPassword(password), now, now));
  }
  try {
    await c.env.DB.batch(statements);
  } catch {
    throw new HttpError(409, "EMAIL_TAKEN", "名单中有邮箱已被占用");
  }

  const csvText = rosterToCsv(accounts);
  const token = newId("dl");
  await c.env.DB.prepare(`INSERT INTO issued_batches
    (id, admin_id, filename, count, download_token_hash, csv_text, downloaded_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)`)
    .bind(newId("bat"), c.get("user").id, body.filename ?? "codequest-accounts.csv",
      accounts.length, await sha256Hex(token), csvText, now).run();

  return c.json({
    count: accounts.length,
    download_url: `/api/v1/admin/accounts/download/${token}`,
    csv: csvText,
  }, 201);
});

adminRoutes.get("/accounts/download/:token", async (c) => {
  const hash = await sha256Hex(c.req.param("token"));
  const batch = await c.env.DB.prepare(
    "SELECT * FROM issued_batches WHERE download_token_hash = ?1 AND downloaded_at IS NULL",
  ).bind(hash).first<{ csv_text: string; filename: string }>();
  if (!batch) throw new HttpError(404, "LINK_EXPIRED", "发放链接无效或已被使用");
  await c.env.DB.prepare("UPDATE issued_batches SET downloaded_at = ?1 WHERE download_token_hash = ?2")
    .bind(nowIso(), hash).run();
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${batch.filename}"`);
  return c.body(batch.csv_text);
});

adminRoutes.get("/courses", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM courses ORDER BY updated_at DESC").all<CourseRow>();
  return c.json({ courses: rows.results.map(publicCourse) });
});

adminRoutes.post("/courses", async (c) => {
  const body = await parseBody(c, packSchema);
  if (Object.keys(body.pack).length > 500) throw new HttpError(400, "INVALID_PACK", "课程包文件过多");
  const row = await saveCoursePack(c.env, body.pack, c.get("user").id);
  return c.json({ course: publicCourse(row) }, 201);
});

adminRoutes.patch("/courses/:id", async (c) => {
  const body = await parseBody(c, z.object({ enabled: z.boolean() }));
  const result = await c.env.DB.prepare("UPDATE courses SET enabled = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(body.enabled ? 1 : 0, nowIso(), c.req.param("id")).run();
  if (result.meta.changes !== 1) throw new HttpError(404, "NOT_FOUND", "课程不存在");
  return c.json({ ok: true });
});
