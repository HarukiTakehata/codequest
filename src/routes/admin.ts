import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import type { Database, DbStatement } from "../db";
import { assertCoursePackSize, publicCourse, saveCoursePack } from "../lib/course";
import { randomSecret, sha256Hex } from "../lib/crypto";
import { parseRoster, rosterToCsv, type RosterRow } from "../lib/csv";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { emailSchema, identityConflict, usernameSchema } from "../lib/identity";
import { clearExpiredIssuedBatchCredentials } from "../lib/issued-batches";
import { newId } from "../lib/ids";
import { hashPassword, temporaryPassword, validatePassword } from "../lib/password";
import { nowIso } from "../lib/time";
import { normalizeDisplayName } from "../lib/user";
import { requireAdmin, requireStaff, requireUser } from "../middleware/identity";
import type { CourseRow, UserRole, UserRow } from "../types";

export const adminRoutes = new Hono<AppEnv>();
const DOWNLOAD_LINK = /^\/api\/v1\/admin\/accounts\/download\/[^/]+$/;
const DOWNLOAD_TTL_HOURS = 24;
const DEFAULT_FILENAME = "codequest-accounts.csv";
// D1 单查询最多 100 个绑定参数；批量 INSERT 按真实列数切块。
const D1_BINDING_LIMIT = 100;
const USER_INSERT_BATCH = Math.floor(D1_BINDING_LIMIT / 8);
const ISSUANCE_INSERT_BATCH = Math.floor(D1_BINDING_LIMIT / 3);
const CONFLICT_QUERY_BATCH = D1_BINDING_LIMIT - 10;

// 只有精确匹配的 GET 一次性下载链接免登录；路径片段、其他方法和其他路由仍走员工门禁。
const isDownloadLink = (c: Context<AppEnv>) =>
  c.req.method === "GET" && DOWNLOAD_LINK.test(c.req.path);

adminRoutes.use("*", async (c, next) => {
  if (isDownloadLink(c)) return next();
  await requireUser(c, next);
});
adminRoutes.use("*", async (c, next) => {
  if (isDownloadLink(c)) return next();
  await requireStaff(c, next);
});

type BatchRole = Exclude<UserRole, "admin">;

function accountScopeSql(user: UserRow, column = "role"): string {
  return user.role === "teacher" ? `${column} = 'student'` : `${column} IN ('student','teacher','admin')`;
}

function batchScopeSql(user: UserRow, column = "role"): string {
  return accountScopeSql(user, column);
}

function batchRole(user: UserRow, requested?: BatchRole): BatchRole {
  const role = requested ?? "student";
  if (user.role === "teacher" && role !== "student") {
    throw new HttpError(403, "FORBIDDEN", "教师只能创建学生账号");
  }
  return role;
}

interface IssuedBatchRow {
  id: string;
  admin_id: string;
  filename: string;
  role: BatchRole;
  count: number;
  download_token_hash: string;
  csv_text: string | null;
  expires_at: string;
  downloaded_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_id: string;
  actor_username: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: string;
  created_at: string;
}

interface AdminAccountRow extends UserRow {
  batch_id: string | null;
  batch_filename: string | null;
}

type BatchStatus = "pending" | "downloaded" | "expired" | "revoked";

function batchStatus(row: Pick<IssuedBatchRow, "expires_at" | "downloaded_at" | "revoked_at">, at: number): BatchStatus {
  if (row.revoked_at) return "revoked";
  if (row.downloaded_at) return "downloaded";
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= at) return "expired";
  return "pending";
}

function publicBatch(row: IssuedBatchRow, at = Date.now()) {
  return {
    id: row.id,
    filename: row.filename,
    role: row.role,
    count: row.count,
    status: batchStatus(row, at),
    expires_at: row.expires_at,
    downloaded_at: row.downloaded_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  };
}

function auditMetadata(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function publicAudit(row: AuditRow) {
  return {
    id: row.id,
    actor_id: row.actor_id,
    actor_username: row.actor_username,
    actor_email: row.actor_email,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    metadata: auditMetadata(row.metadata_json),
    created_at: row.created_at,
  };
}

function adminAccount(row: AdminAccountRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: normalizeDisplayName(row.display_name),
    role: row.role,
    status: row.status,
    must_change_password: row.must_change_password === 1,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    password_updated_at: row.password_updated_at,
    batch_id: row.batch_id,
    batch_filename: row.batch_filename,
  };
}

function adminCourse(row: CourseRow) {
  return {
    ...publicCourse(row),
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface AuditGuard {
  sql: (offset: number) => string;
  values: (string | number | null)[];
}

function auditStatement(
  db: Database,
  actor: UserRow,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>,
  createdAt: string,
  guard?: AuditGuard,
): DbStatement {
  const values: (string | number | null)[] = [
    newId("adt"), actor.id, actor.username, actor.email, action, targetType, targetId,
    JSON.stringify(metadata), createdAt,
  ];
  const sql = guard
    ? `INSERT INTO admin_audit_events
       (id, actor_id, actor_username, actor_email, action, target_type, target_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${guard.sql(9)}`
    : `INSERT INTO admin_audit_events
       (id, actor_id, actor_username, actor_email, action, target_type, target_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`;
  return db.prepare(sql).bind(...values, ...(guard?.values ?? []));
}

function pagination(c: Context<AppEnv>): { limit: number; offset: number } {
  const parse = (raw: string | undefined, fallback: number, min: number, max?: number) => {
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new HttpError(400, "INVALID_ARGUMENT", "分页参数必须是整数");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
      throw new HttpError(400, "INVALID_ARGUMENT", "分页参数超出范围");
    }
    return value;
  };
  return { limit: parse(c.req.query("limit"), 20, 1, 100), offset: parse(c.req.query("offset"), 0, 0) };
}

function validateRoster(roster: RosterRow[]): void {
  const usernames = new Set<string>();
  const emails = new Set<string>();
  for (const row of roster) {
    if (usernames.has(row.username)) throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: 用户名重复 ${row.username}`);
    usernames.add(row.username);
    if (row.email !== null) {
      if (emails.has(row.email)) throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: 邮箱重复 ${row.email}`);
      emails.add(row.email);
    }
    if (row.display_name.length > 120) throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: 显示名称最多 120 个字符`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.display_name)) {
      throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: 显示名称包含非法控制字符`);
    }
    if (row.password) {
      if (/[\u0000-\u001f\u007f]/.test(row.password)) throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: 初始密码不能包含控制字符`);
      const error = validatePassword(row.password);
      if (error) throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: ${row.username}: ${error}`);
      if (/^[=+\-@]/.test(row.password)) {
        throw new HttpError(400, "INVALID_CSV", `CSV 第 ${row.line} 行: 初始密码不能以 =、+、- 或 @ 开头`);
      }
    }
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function existingIdentities(db: Database, roster: RosterRow[]): Promise<{ usernames: Set<string>; emails: Set<string> }> {
  const usernames = new Set<string>();
  const emails = new Set<string>();
  for (const chunk of chunks(roster, CONFLICT_QUERY_BATCH)) {
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const existing = await db.prepare(`SELECT username FROM users WHERE username IN (${placeholders})`)
      .bind(...chunk.map((row) => row.username)).all<{ username: string }>();
    for (const row of existing.results) usernames.add(row.username.toLowerCase());
  }
  const emailRows = roster.filter((row): row is RosterRow & { email: string } => row.email !== null);
  for (const chunk of chunks(emailRows, CONFLICT_QUERY_BATCH)) {
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const existing = await db.prepare(`SELECT email FROM users WHERE email IN (${placeholders})`)
      .bind(...chunk.map((row) => row.email)).all<{ email: string }>();
    for (const row of existing.results) emails.add(row.email.toLowerCase());
  }
  return { usernames, emails };
}

function attachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || DEFAULT_FILENAME;
  try {
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  } catch {
    return `attachment; filename="${fallback}"`;
  }
}

const batchSchema = z.object({
  csv: z.string().min(1).max(200_000),
  role: z.enum(["student", "teacher"]).optional(),
  filename: z.string().trim().min(1).max(120).refine(
    (value) => !/[\u0000-\u001f\u007f"\\/]/.test(value),
    "文件名不能包含控制字符、路径分隔符或双引号",
  ).optional(),
});
const packSchema = z.object({ pack: z.record(z.string(), z.string()) });
const accountPatchSchema = z.object({
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
  display_name: z.string().trim().max(120).optional(),
  role: z.enum(["student", "teacher", "admin"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).refine((body) => body.username !== undefined || body.email !== undefined ||
  body.display_name !== undefined || body.role !== undefined || body.status !== undefined,
"至少提供一个要修改的字段");

/** nginx auth_request：管理员 204，未登录 401 / 非管理员 403。 */
adminRoutes.get("/check", requireAdmin, (c) => c.body(null, 204));

adminRoutes.get("/config", async (c) => {
  const instance = await c.get("db").prepare("SELECT v FROM instance_settings WHERE k = 'instance_name'").first<{ v: string | null }>();
  return c.json({
    instance_name: instance?.v?.trim() || "CodeQuest",
    editor_url: c.env.EDITOR_URL?.trim() || null,
    learner_url: c.env.LEARNER_URL?.trim() || null,
    download_link_ttl_hours: DOWNLOAD_TTL_HOURS,
  });
});

adminRoutes.get("/overview", async (c) => {
  const user = c.get("user");
  const now = nowIso();
  await clearExpiredIssuedBatchCredentials(c.get("db"), now);
  const at = Date.parse(now);
  const batchScope = batchScopeSql(user);
  const counts = await c.get("db").prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'student') AS accounts_total,
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active') AS accounts_active,
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'disabled') AS accounts_disabled,
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND must_change_password = 1) AS password_required,
      (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS teachers_total,
      (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND status = 'active') AS teachers_active,
      (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND status = 'disabled') AS teachers_disabled,
      (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND must_change_password = 1) AS teachers_password_required,
      (SELECT COUNT(*) FROM courses) AS courses_total,
      (SELECT COUNT(*) FROM courses WHERE enabled = 1) AS courses_enabled,
      (SELECT COUNT(*) FROM issued_batches
        WHERE ${batchScope} AND revoked_at IS NULL AND downloaded_at IS NULL AND expires_at > ?1) AS batches_pending,
      (SELECT COUNT(*) FROM issued_batches
        WHERE ${batchScope} AND downloaded_at IS NOT NULL) AS batches_downloaded,
      (SELECT COUNT(*) FROM issued_batches
        WHERE ${batchScope} AND revoked_at IS NULL AND downloaded_at IS NULL AND expires_at <= ?1) AS batches_expired,
      (SELECT COUNT(*) FROM issued_batches
        WHERE ${batchScope} AND revoked_at IS NOT NULL) AS batches_revoked
  `).bind(now).first<Record<string, number>>();
  const recentBatches = await c.get("db").prepare(`
    SELECT id, filename, role, count, expires_at, downloaded_at, revoked_at, created_at
    FROM issued_batches WHERE ${batchScope} ORDER BY created_at DESC, id DESC LIMIT 5
  `).all<IssuedBatchRow>();
  const recentAudit = user.role === "admin" ? (await c.get("db").prepare(`
    SELECT * FROM admin_audit_events ORDER BY created_at DESC, id DESC LIMIT 5
  `).all<AuditRow>()).results : [];
  return c.json({
    accounts: {
      total: counts?.accounts_total ?? 0,
      active: counts?.accounts_active ?? 0,
      disabled: counts?.accounts_disabled ?? 0,
      password_change_required: counts?.password_required ?? 0,
    },
    teachers: {
      total: counts?.teachers_total ?? 0,
      active: counts?.teachers_active ?? 0,
      disabled: counts?.teachers_disabled ?? 0,
      password_change_required: counts?.teachers_password_required ?? 0,
    },
    courses: { total: counts?.courses_total ?? 0, enabled: counts?.courses_enabled ?? 0 },
    batches: {
      pending: counts?.batches_pending ?? 0,
      downloaded: counts?.batches_downloaded ?? 0,
      expired: counts?.batches_expired ?? 0,
      revoked: counts?.batches_revoked ?? 0,
    },
    recent_batches: recentBatches.results.map((row) => publicBatch(row, at)),
    recent_audit: recentAudit.map(publicAudit),
  });
});

adminRoutes.get("/audit", requireAdmin, async (c) => {
  const { limit, offset } = pagination(c);
  const total = await c.get("db").prepare("SELECT COUNT(*) AS n FROM admin_audit_events").first<{ n: number }>();
  const events = await c.get("db").prepare(`
    SELECT * FROM admin_audit_events ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all<AuditRow>();
  return c.json({ events: events.results.map(publicAudit), total: total?.n ?? 0, limit, offset });
});

adminRoutes.post("/accounts/batch/preview", async (c) => {
  const body = await parseBody(c, batchSchema);
  batchRole(c.get("user"), body.role);
  const roster = parseRoster(body.csv);
  validateRoster(roster);
  const existing = await existingIdentities(c.get("db"), roster);
  const specifiedCount = roster.filter((row) => row.password !== undefined).length;
  const conflicts = roster.flatMap((row) => [
    ...(existing.usernames.has(row.username) ? [row.username] : []),
    ...(row.email !== null && existing.emails.has(row.email) ? [row.email] : []),
  ]);
  return c.json({
    filename: body.filename ?? DEFAULT_FILENAME,
    count: roster.length,
    generated_count: roster.length - specifiedCount,
    specified_count: specifiedCount,
    rows: roster.map((row) => ({
      username: row.username,
      email: row.email,
      display_name: row.display_name,
      password_mode: row.password === undefined ? "generated" : "specified",
    })),
    conflicts,
  });
});

/** 用户、来源关系、批次与审计必须在同一个 D1 batch 中提交。 */
adminRoutes.post("/accounts/batch", async (c) => {
  const body = await parseBody(c, batchSchema);
  const role = batchRole(c.get("user"), body.role);
  const roster = parseRoster(body.csv);
  validateRoster(roster);
  const existing = await existingIdentities(c.get("db"), roster);
  if (existing.usernames.size > 0) throw new HttpError(409, "USERNAME_TAKEN", "名单中有用户名已被占用");
  if (existing.emails.size > 0) throw new HttpError(409, "EMAIL_TAKEN", "名单中有邮箱已被占用");
  const filename = body.filename ?? DEFAULT_FILENAME;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const batchId = newId("bat");
  const token = randomSecret(32);
  const tokenHash = await sha256Hex(`${token}${c.env.TOKEN_PEPPER}`);
  const accounts: { id: string; username: string; email: string | null; display_name: string; password: string; passwordHash: string }[] = [];
  for (const row of roster) {
    const password = row.password ?? temporaryPassword();
    accounts.push({
      id: newId("usr"), username: row.username, email: row.email, display_name: row.display_name,
      password, passwordHash: await hashPassword(password),
    });
  }
  const csvText = rosterToCsv(accounts);
  const batch: IssuedBatchRow = {
    id: batchId,
    admin_id: c.get("user").id,
    filename,
    role,
    count: accounts.length,
    download_token_hash: tokenHash,
    csv_text: csvText,
    expires_at: expiresAt,
    downloaded_at: null,
    revoked_at: null,
    created_at: now,
  };
  const statements: DbStatement[] = [];
  for (const chunk of chunks(accounts, USER_INSERT_BATCH)) {
    const values: (string | number | null)[] = [];
    const rows = chunk.map((account, index) => {
      const base = index * 8;
      values.push(account.id, account.username, account.email, account.display_name, role, account.passwordHash, now, now);
      return `(?${base + 1}, ?${base + 2}, ?${base + 3}, ?${base + 4}, ?${base + 5}, 'active', ?${base + 6}, ?${base + 7}, 1, 1, NULL, ?${base + 8})`;
    }).join(",");
    statements.push(c.get("db").prepare(`INSERT INTO users
      (id, username, email, display_name, role, status, password_hash, password_updated_at, must_change_password, auth_version, last_seen_at, created_at)
      VALUES ${rows}`).bind(...values));
  }
  statements.push(c.get("db").prepare(`INSERT INTO issued_batches
    (id, admin_id, filename, role, count, download_token_hash, csv_text, expires_at, downloaded_at, revoked_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, ?9)`)
    .bind(batch.id, batch.admin_id, batch.filename, batch.role, batch.count, batch.download_token_hash,
      batch.csv_text, batch.expires_at, batch.created_at));
  for (const chunk of chunks(accounts, ISSUANCE_INSERT_BATCH)) {
    const values: (string | number | null)[] = [];
    const rows = chunk.map((account, index) => {
      const base = index * 3;
      values.push(account.id, batchId, now);
      return `(?${base + 1}, ?${base + 2}, ?${base + 3})`;
    }).join(",");
    statements.push(c.get("db").prepare(`INSERT INTO user_issuance (user_id, batch_id, created_at) VALUES ${rows}`)
      .bind(...values));
  }
  statements.push(auditStatement(c.get("db"), c.get("user"), "batch_created", "issued_batch", batch.id, {
    filename, role, count: accounts.length,
  }, now));
  try {
    await c.get("db").batch(statements);
  } catch (error) {
    const conflict = identityConflict(error);
    if (conflict) throw new HttpError(409, conflict.code, conflict.message);
    throw error;
  }
  c.header("Cache-Control", "no-store");
  return c.json({ batch: publicBatch(batch, Date.parse(now)), download_url: `/api/v1/admin/accounts/download/${token}` }, 201);
});

adminRoutes.get("/accounts/download/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, "LINK_EXPIRED", "发放链接无效或已被使用");
  const now = nowIso();
  const hash = await sha256Hex(`${token}${c.env.TOKEN_PEPPER}`);
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  // 条件 UPDATE 与 RETURNING 原子消费；数据库触发器在同一语句内清空 csv_text。
  const consumed = await c.get("db").prepare(`
    UPDATE issued_batches SET downloaded_at = ?1
    WHERE download_token_hash = ?2 AND downloaded_at IS NULL AND revoked_at IS NULL
      AND expires_at > ?1 AND csv_text IS NOT NULL
    RETURNING filename, csv_text
  `).bind(now, hash).all<{ filename: string; csv_text: string }>();
  const batch = consumed.results[0];
  if (!batch) throw new HttpError(404, "LINK_EXPIRED", "发放链接无效或已被使用");
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", attachment(batch.filename));
  return c.body(batch.csv_text);
});

adminRoutes.get("/accounts/batches", async (c) => {
  const { limit, offset } = pagination(c);
  const batchScope = batchScopeSql(c.get("user"));
  await clearExpiredIssuedBatchCredentials(c.get("db"));
  const total = await c.get("db").prepare(`SELECT COUNT(*) AS n FROM issued_batches WHERE ${batchScope}`)
    .first<{ n: number }>();
  const rows = await c.get("db").prepare(`
    SELECT id, filename, role, count, expires_at, downloaded_at, revoked_at, created_at
    FROM issued_batches WHERE ${batchScope} ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all<IssuedBatchRow>();
  return c.json({ batches: rows.results.map((row) => publicBatch(row)), total: total?.n ?? 0, limit, offset });
});

adminRoutes.delete("/accounts/batches/:id", async (c) => {
  const id = c.req.param("id");
  const now = nowIso();
  const batchScope = batchScopeSql(c.get("user"));
  const results = await c.get("db").batch([
    c.get("db").prepare(`
      UPDATE issued_batches SET revoked_at = ?1, csv_text = NULL
      WHERE id = ?2 AND ${batchScope} AND downloaded_at IS NULL AND revoked_at IS NULL AND expires_at > ?1
    `).bind(now, id),
    auditStatement(c.get("db"), c.get("user"), "batch_revoked", "issued_batch", id, {}, now, {
      sql: () => "changes() = 1",
      values: [],
    }),
  ]);
  if (results[0]!.changes !== 1) {
    const row = await c.get("db").prepare(`SELECT id FROM issued_batches WHERE id = ?1 AND ${batchScope}`)
      .bind(id).first();
    if (!row) throw new HttpError(404, "NOT_FOUND", "发号批次不存在");
    throw new HttpError(409, "BATCH_NOT_PENDING", "只能撤销尚未领取且未过期的批次");
  }
  return c.json({ ok: true });
});

adminRoutes.get("/accounts", async (c) => {
  const { limit, offset } = pagination(c);
  const user = c.get("user");
  const parsedFilters = z.object({
    query: z.string().trim().max(254).optional(),
    role: z.enum(["student", "teacher", "admin"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    password_state: z.enum(["required", "ready"]).optional(),
  }).safeParse({
    query: c.req.query("query") || undefined,
    role: c.req.query("role") || undefined,
    status: c.req.query("status") || undefined,
    password_state: c.req.query("password_state") || undefined,
  });
  if (!parsedFilters.success) throw new HttpError(400, "INVALID_ARGUMENT", "账号筛选参数不合法");
  const filters = parsedFilters.data;
  if (user.role === "teacher" && filters.role !== undefined && filters.role !== "student") {
    throw new HttpError(403, "FORBIDDEN", "教师只能管理学生账号");
  }
  const where = [accountScopeSql(user, "u.role")];
  const values: (string | number)[] = [];
  if (filters.query) {
    // instr 按字面子串搜索，避免 D1 对 LIKE pattern 的 50 字节上限。
    where.push("(instr(lower(u.username), lower(?1)) > 0 OR instr(lower(COALESCE(u.email, '')), lower(?1)) > 0 OR instr(lower(COALESCE(u.display_name, '')), lower(?1)) > 0)");
    values.push(filters.query);
  }
  if (filters.role) {
    values.push(filters.role);
    where.push(`u.role = ?${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`u.status = ?${values.length}`);
  }
  if (filters.password_state) {
    values.push(filters.password_state === "required" ? 1 : 0);
    where.push(`u.must_change_password = ?${values.length}`);
  }
  const predicate = where.join(" AND ");
  const total = await c.get("db").prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${predicate}`)
    .bind(...values).first<{ n: number }>();
  const listValues = [...values, limit, offset];
  const rows = await c.get("db").prepare(`
    SELECT u.*, ui.batch_id, b.filename AS batch_filename
    FROM users u
    LEFT JOIN user_issuance ui ON ui.user_id = u.id
    LEFT JOIN issued_batches b ON b.id = ui.batch_id
    WHERE ${predicate}
    ORDER BY u.created_at DESC, u.id DESC LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}
  `).bind(...listValues).all<AdminAccountRow>();
  return c.json({ accounts: rows.results.map(adminAccount), total: total?.n ?? 0, limit, offset });
});

adminRoutes.patch("/accounts/:id", async (c) => {
  const body = await parseBody(c, accountPatchSchema);
  const user = c.get("user");
  if (user.role === "teacher" && body.role !== undefined) {
    throw new HttpError(403, "FORBIDDEN", "教师不能修改账号角色");
  }
  const id = c.req.param("id");
  const accountScope = accountScopeSql(user);
  const target = await c.get("db").prepare(`
    SELECT id, role, status FROM users WHERE id = ?1 AND ${accountScope}
  `).bind(id).first<Pick<UserRow, "id" | "role" | "status">>();
  if (!target) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  const removesActiveAdmin = target.role === "admin" && target.status === "active" && (
    (body.role !== undefined && body.role !== "admin") || body.status === "disabled"
  );
  const displayName = body.display_name === undefined ? undefined : normalizeDisplayName(body.display_name);
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  const metadata: Record<string, unknown> = {};
  const expected = [accountScope, "id = ?10"];
  const auditValues: (string | number | null)[] = [id];
  let parameter = 1;
  let auditParameter = 11;
  const bind = () => `?${parameter++}`;
  const assign = (column: string, value: string | null, key: string, nullSafe = false) => {
    assignments.push(`${column} = ${bind()}`);
    values.push(value);
    metadata[key] = value;
    expected.push(`${column} ${nullSafe ? "IS" : "="} ?${auditParameter++}`);
    auditValues.push(value);
  };
  if (body.username !== undefined) assign("username", body.username, "username");
  if (body.email !== undefined) assign("email", body.email, "email", true);
  if (displayName !== undefined) assign("display_name", displayName, "display_name", true);
  if (body.role !== undefined) assign("role", body.role, "role");
  if (body.status !== undefined) assign("status", body.status, "status");
  if (body.role !== undefined || body.status !== undefined) {
    assignments.push("auth_version = auth_version + 1");
  }
  const idParameter = parameter++;
  values.push(id);
  let updateScope = `id = ?${idParameter} AND ${accountScope}`;
  if (removesActiveAdmin) {
    const otherAdminParameter = parameter++;
    values.push(id);
    updateScope += ` AND EXISTS (
      SELECT 1 FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?${otherAdminParameter}
    )`;
  }
  const now = nowIso();
  const statements = [
    c.get("db").prepare(`UPDATE users SET ${assignments.join(", ")} WHERE ${updateScope}`)
      .bind(...values),
    auditStatement(c.get("db"), user, "account_updated", "user", id, metadata, now, {
      sql: () => `EXISTS (SELECT 1 FROM users WHERE ${expected.join(" AND ")})`,
      values: auditValues,
    }),
  ];
  if (body.role !== undefined || body.status !== undefined) {
    const sessionValues: (string | number | null)[] = [now, id];
    const sessionExpectations: string[] = [];
    let sessionParameter = 3;
    if (body.role !== undefined) {
      sessionExpectations.push(`role = ?${sessionParameter++}`);
      sessionValues.push(body.role);
    }
    if (body.status !== undefined) {
      sessionExpectations.push(`status = ?${sessionParameter++}`);
      sessionValues.push(body.status);
    }
    statements.push(c.get("db").prepare(`
      UPDATE user_sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND ${accountScope}
          ${sessionExpectations.length ? `AND ${sessionExpectations.join(" AND ")}` : ""})
    `).bind(...sessionValues));
  }
  const results = await c.get("db").batch(statements).catch((error: unknown) => {
    const conflict = identityConflict(error);
    if (conflict) throw new HttpError(409, conflict.code, conflict.message);
    throw error;
  });
  if (results[0]!.changes !== 1) {
    if (removesActiveAdmin) {
      throw new HttpError(409, "LAST_ACTIVE_ADMIN", "至少需要保留一个活跃管理员账号");
    }
    throw new HttpError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  }
  const row = await c.get("db").prepare(`
    SELECT u.*, ui.batch_id, b.filename AS batch_filename
    FROM users u LEFT JOIN user_issuance ui ON ui.user_id = u.id
    LEFT JOIN issued_batches b ON b.id = ui.batch_id WHERE u.id = ?1 AND ${accountScopeSql(user, "u.role")}
  `).bind(id).first<AdminAccountRow>();
  if (!row) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  return c.json({ account: adminAccount(row) });
});

adminRoutes.post("/accounts/:id/password-reset", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  if (id === user.id) {
    throw new HttpError(403, "CANNOT_RESET_OWN_PASSWORD", "不能重置自己的密码，请通过个人资料自主改密");
  }
  const accountScope = accountScopeSql(user);
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const now = nowIso();
  const results = await c.get("db").batch([
    c.get("db").prepare(`
      UPDATE users SET password_hash = ?1, password_updated_at = ?2, must_change_password = 1,
        auth_version = auth_version + 1
      WHERE id = ?3 AND ${accountScope}
    `).bind(passwordHash, now, id),
    auditStatement(c.get("db"), user, "account_password_reset", "user", id, {}, now, {
      sql: (offset) => `EXISTS (SELECT 1 FROM users WHERE id = ?${offset + 1} AND ${accountScope}
        AND password_hash = ?${offset + 2} AND must_change_password = 1)`,
      values: [id, passwordHash],
    }),
    c.get("db").prepare(`
      UPDATE user_sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND ${accountScope} AND password_hash = ?3)
    `).bind(now, id, passwordHash),
  ]);
  if (results[0]!.changes !== 1) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  c.header("Cache-Control", "no-store");
  return c.json({ temporary_password: password, must_change_password: true });
});

adminRoutes.get("/courses", async (c) => {
  const rows = await c.get("db").prepare("SELECT * FROM courses ORDER BY updated_at DESC, id DESC").all<CourseRow>();
  return c.json({ courses: rows.results.map(adminCourse) });
});

adminRoutes.post("/courses", async (c) => {
  const body = await parseBody(c, packSchema);
  if (Object.keys(body.pack).length > 500) throw new HttpError(400, "INVALID_PACK", "课程包文件过多");
  assertCoursePackSize(body.pack);
  const row = await saveCoursePack(c.env, c.get("db"), body.pack, c.get("user").id, (course) => [
    auditStatement(c.get("db"), c.get("user"), course.version === 1 ? "course_created" : "course_updated",
      "course", course.id, { slug: course.slug, version: course.version }, course.updated_at, {
        sql: (offset) => `EXISTS (SELECT 1 FROM courses WHERE id = ?${offset + 1} AND version = ?${offset + 2})`,
        values: [course.id, course.version],
      }),
  ]);
  return c.json({ course: adminCourse(row) }, 201);
});

adminRoutes.patch("/courses/:id", async (c) => {
  const body = await parseBody(c, z.object({ enabled: z.boolean() }));
  const id = c.req.param("id");
  const enabled = body.enabled ? 1 : 0;
  const now = nowIso();
  const results = await c.get("db").batch([
    c.get("db").prepare("UPDATE courses SET enabled = ?1, updated_at = ?2 WHERE id = ?3").bind(enabled, now, id),
    auditStatement(c.get("db"), c.get("user"), "course_updated", "course", id, { enabled: body.enabled }, now, {
      sql: (offset) => `EXISTS (SELECT 1 FROM courses WHERE id = ?${offset + 1}
        AND enabled = ?${offset + 2} AND updated_at = ?${offset + 3})`,
      values: [id, enabled, now],
    }),
  ]);
  if (results[0]!.changes !== 1) throw new HttpError(404, "NOT_FOUND", "课程不存在");
  const row = await c.get("db").prepare("SELECT * FROM courses WHERE id = ?1").bind(id).first<CourseRow>();
  if (!row) throw new HttpError(404, "NOT_FOUND", "课程不存在");
  return c.json({ course: adminCourse(row) });
});
