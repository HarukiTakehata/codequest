import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { emailSchema, identifierSchema, identityConflict, usernameSchema } from "../lib/identity";
import { newId } from "../lib/ids";
import { instanceUserCount } from "../lib/instance-setup";
import { hashPassword, validatePassword, verifyPassword } from "../lib/password";
import {
  createSession, hashIp, readSession, recordAuthEvent, requestFingerprint,
  revokeCurrentSession, updatePassword,
} from "../lib/session";
import { nowIso } from "../lib/time";
import { normalizeDisplayName, publicUser } from "../lib/user";
import { requireUser } from "../middleware/identity";
import type { UserRow } from "../types";

export const authRoutes = new Hono<AppEnv>();
const loginSchema = z.object({ identifier: identifierSchema, password: z.string().min(1).max(200) });
const accountSchema = z.object({
  username: usernameSchema,
  email: emailSchema.optional(),
  display_name: z.string().max(120).optional(),
});
const registerSchema = accountSchema.extend({ password: z.string().min(1).max(200) });
const changeSchema = z.object({ current_password: z.string().min(1), new_password: z.string().min(1).max(200) });

const MAX_FAILED = 5;
const WINDOW_MS = 15 * 60 * 1000;

async function authEvent(c: Parameters<typeof parseBody>[0], userId: string | null, identifier: string, eventType: string): Promise<void> {
  const fp = requestFingerprint(c);
  await recordAuthEvent(c.get("db"), {
    userId, identifier, eventType, ipHash: await hashIp(c, fp.ip), userAgent: fp.userAgent,
  });
}

authRoutes.get("/auth/status", async (c) => {
  const learnerUrl = c.env.LEARNER_URL?.trim();
  return c.json({
    needs_bootstrap: (await instanceUserCount(c.get("db"))) === 0,
    setup_url: learnerUrl ? `${learnerUrl.replace(/\/+$/, "")}/setup` : "/setup",
    auth_mode: c.env.AUTH_MODE ?? "session",
    registration_enabled: c.env.REGISTRATION_ENABLED === true || c.env.REGISTRATION_ENABLED === "true",
  });
});

/** 注册接口保留实现，默认关闭（v0.2：账号由教师/管理员批量发放）。 */
authRoutes.post("/auth/register", async (c) => {
  const enabled = c.env.REGISTRATION_ENABLED === true || c.env.REGISTRATION_ENABLED === "true";
  if (!enabled) throw new HttpError(403, "REGISTRATION_DISABLED", "注册未开放，请联系教师或管理员领取账号");
  const body = await parseBody(c, registerSchema);
  const passwordError = validatePassword(body.password);
  if (passwordError) throw new HttpError(400, "INVALID_ARGUMENT", passwordError);
  const email = body.email ?? null;
  const db = c.get("db");
  const exists = await db.prepare("SELECT username, email FROM users WHERE username = ?1 OR email = ?2")
    .bind(body.username, email).first<UserRow>();
  if (exists) {
    if (exists.username === body.username) throw new HttpError(409, "USERNAME_TAKEN", "用户名已被使用");
    throw new HttpError(409, "EMAIL_TAKEN", "邮箱已被使用");
  }
  const now = nowIso();
  const user: UserRow = {
    id: newId("usr"), username: body.username, email, display_name: normalizeDisplayName(body.display_name),
    role: "student", status: "active", password_hash: await hashPassword(body.password),
    password_updated_at: now, must_change_password: 0, auth_version: 1,
    last_seen_at: now, created_at: now,
  };
  try {
    await db.prepare(`INSERT INTO users
      (id, username, email, display_name, role, status, password_hash, password_updated_at, must_change_password, last_seen_at, created_at)
      VALUES (?1, ?2, ?3, ?4, 'student', 'active', ?5, ?6, 0, ?6, ?6)`)
      .bind(user.id, user.username, user.email, user.display_name, user.password_hash, now).run();
  } catch (error) {
    const conflict = identityConflict(error);
    if (conflict) throw new HttpError(409, conflict.code, conflict.message);
    throw error;
  }
  await authEvent(c, user.id, user.username, "register");
  await createSession(c, user);
  return c.json({ user: publicUser(user) }, 201);
});

authRoutes.post("/auth/login", async (c) => {
  const body = await parseBody(c, loginSchema);
  const identifier = body.identifier;
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const db = c.get("db");
  const failures = await db.prepare(
    "SELECT COUNT(*) AS n FROM user_auth_events WHERE identifier = ?1 AND event_type = 'login_failed' AND created_at > ?2",
  ).bind(identifier, cutoff).first<{ n: number }>();
  if ((failures?.n ?? 0) >= MAX_FAILED) throw new HttpError(429, "RATE_LIMITED", "失败次数过多，请稍后再试");

  // 用户名优先；未命中时再按邮箱查找，避免标识符类型影响账号选择。
  let user = await db.prepare("SELECT * FROM users WHERE username = ?1").bind(identifier).first<UserRow>();
  if (!user) user = await db.prepare("SELECT * FROM users WHERE email = ?1").bind(identifier).first<UserRow>();
  const ok = user ? await verifyPassword(body.password, user.password_hash) : false;
  if (!user || !ok) {
    await authEvent(c, user?.id ?? null, identifier, "login_failed");
    throw new HttpError(401, "INVALID_CREDENTIALS", "用户名、邮箱或密码错误");
  }
  if (user.status !== "active") throw new HttpError(403, "USER_DISABLED", "账号已停用");
  await createSession(c, user);
  user.last_seen_at = nowIso();
  await db.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2").bind(user.last_seen_at, user.id).run();
  await authEvent(c, user.id, identifier, "login_success");
  return c.json({ user: publicUser(user), must_change_password: user.must_change_password === 1 });
});

authRoutes.post("/auth/logout", async (c) => {
  const user = await readSession(c);
  if (user) await authEvent(c, user.id, user.username, "logout");
  await revokeCurrentSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/auth/me", requireUser, (c) => c.json({ user: publicUser(c.get("user")) }));

authRoutes.post("/auth/password", requireUser, async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, changeSchema);
  if (!(await verifyPassword(body.current_password, user.password_hash))) {
    throw new HttpError(401, "CURRENT_PASSWORD_INCORRECT", "当前密码不正确");
  }
  const passwordError = validatePassword(body.new_password);
  if (passwordError) throw new HttpError(400, "INVALID_ARGUMENT", passwordError);
  if (body.current_password === body.new_password) throw new HttpError(400, "INVALID_ARGUMENT", "新密码不能与旧密码相同");
  await updatePassword(c.get("db"), user, await hashPassword(body.new_password), false);
  await authEvent(c, user.id, user.username, "password_changed");
  await revokeCurrentSession(c);
  return c.json({ ok: true, reauth_required: true });
});
