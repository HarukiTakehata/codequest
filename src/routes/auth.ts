import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { newId } from "../lib/ids";
import { bootstrapClaim } from "../lib/bootstrap";
import { hashPassword, validatePassword, verifyPassword } from "../lib/password";
import {
  createSession, hashIp, readSession, recordAuthEvent, requestFingerprint,
  revokeCurrentSession, updatePassword,
} from "../lib/session";
import { nowIso } from "../lib/time";
import { requireUser } from "../middleware/identity";
import type { UserRow } from "../types";

export const authRoutes = new Hono<AppEnv>();

const credentials = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const bootstrapSchema = credentials.extend({ display_name: z.string().max(120).optional() });
const registerSchema = credentials.extend({ display_name: z.string().max(120).optional() });
const changeSchema = z.object({ current_password: z.string().min(1), new_password: z.string().min(1).max(200) });

const MAX_FAILED = 5;
const WINDOW_MS = 15 * 60 * 1000;

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    status: user.status,
    must_change_password: user.must_change_password === 1,
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
  };
}

async function authEvent(c: Parameters<typeof parseBody>[0], userId: string | null, email: string, eventType: string): Promise<void> {
  const fp = requestFingerprint(c);
  await recordAuthEvent(c.env.DB, {
    userId, email, eventType, ipHash: await hashIp(c, fp.ip), userAgent: fp.userAgent,
  });
}

async function userCount(db: D1Database): Promise<number> {
  const row = await db.prepare(
    "SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM instance_settings WHERE k = 'bootstrap_claim') AS n",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

authRoutes.get("/auth/status", async (c) => c.json({
  needs_bootstrap: (await userCount(c.env.DB)) === 0,
  auth_mode: c.env.AUTH_MODE ?? "session",
  registration_enabled: c.env.REGISTRATION_ENABLED === true || c.env.REGISTRATION_ENABLED === "true",
}));

authRoutes.post("/auth/bootstrap", async (c) => {
  if (await userCount(c.env.DB) > 0) throw new HttpError(409, "BOOTSTRAP_COMPLETED", "实例已初始化");
  const body = await parseBody(c, bootstrapSchema);
  const passwordError = validatePassword(body.password);
  if (passwordError) throw new HttpError(400, "INVALID_ARGUMENT", passwordError);
  const now = nowIso();
  const user: UserRow = {
    id: newId("usr"), email: body.email.trim().toLowerCase(),
    display_name: body.display_name?.trim() ?? null, role: "admin", status: "active",
    password_hash: await hashPassword(body.password), password_updated_at: now,
    must_change_password: 0, auth_version: 1, last_seen_at: now, created_at: now,
  };
  try {
    await c.env.DB.batch([
      bootstrapClaim(c.env.DB, user.id),
      c.env.DB.prepare(`INSERT INTO users
        (id, email, display_name, role, status, password_hash, password_updated_at, must_change_password, last_seen_at, created_at)
        VALUES (?1, ?2, ?3, 'admin', 'active', ?4, ?5, 0, ?5, ?5)`)
        .bind(user.id, user.email, user.display_name, user.password_hash, now),
    ]);
  } catch {
    throw new HttpError(409, "BOOTSTRAP_COMPLETED", "实例已初始化");
  }
  await authEvent(c, user.id, user.email, "bootstrap");
  await createSession(c, user);
  return c.json({ user: publicUser(user) }, 201);
});

/** 注册接口保留实现，默认关闭（v0.2：账号由管理员批量发放）。 */
authRoutes.post("/auth/register", async (c) => {
  const enabled = c.env.REGISTRATION_ENABLED === true || c.env.REGISTRATION_ENABLED === "true";
  if (!enabled) throw new HttpError(403, "REGISTRATION_DISABLED", "注册未开放，请联系管理员领取账号");
  const body = await parseBody(c, registerSchema);
  const passwordError = validatePassword(body.password);
  if (passwordError) throw new HttpError(400, "INVALID_ARGUMENT", passwordError);
  const email = body.email.trim().toLowerCase();
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?1").bind(email).first();
  if (exists) throw new HttpError(409, "EMAIL_TAKEN", "邮箱已被使用");
  const now = nowIso();
  const user: UserRow = {
    id: newId("usr"), email, display_name: body.display_name?.trim() ?? null,
    role: "member", status: "active", password_hash: await hashPassword(body.password),
    password_updated_at: now, must_change_password: 0, auth_version: 1,
    last_seen_at: now, created_at: now,
  };
  await c.env.DB.prepare(`INSERT INTO users
    (id, email, display_name, role, status, password_hash, password_updated_at, must_change_password, last_seen_at, created_at)
    VALUES (?1, ?2, ?3, 'member', 'active', ?4, ?5, 0, ?5, ?5)`)
    .bind(user.id, user.email, user.display_name, user.password_hash, now).run();
  await authEvent(c, user.id, user.email, "bootstrap");
  await createSession(c, user);
  return c.json({ user: publicUser(user) }, 201);
});

authRoutes.post("/auth/login", async (c) => {
  const body = await parseBody(c, credentials);
  const email = body.email.trim().toLowerCase();
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const failures = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM user_auth_events WHERE email = ?1 AND event_type = 'login_failed' AND created_at > ?2",
  ).bind(email, cutoff).first<{ n: number }>();
  if ((failures?.n ?? 0) >= MAX_FAILED) throw new HttpError(429, "RATE_LIMITED", "失败次数过多，请稍后再试");

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first<UserRow>();
  const ok = user ? await verifyPassword(body.password, user.password_hash) : false;
  if (!user || !ok) {
    await authEvent(c, user?.id ?? null, email, "login_failed");
    throw new HttpError(401, "INVALID_CREDENTIALS", "邮箱或密码错误");
  }
  if (user.status !== "active") throw new HttpError(403, "USER_DISABLED", "账号已停用");
  await createSession(c, user);
  await c.env.DB.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2").bind(nowIso(), user.id).run();
  await authEvent(c, user.id, email, "login_success");
  return c.json({ user: publicUser(user), must_change_password: user.must_change_password === 1 });
});

authRoutes.post("/auth/logout", async (c) => {
  const user = await readSession(c);
  if (user) await authEvent(c, user.id, user.email, "logout");
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
  await updatePassword(c.env.DB, user, await hashPassword(body.new_password), false);
  await authEvent(c, user.id, user.email, "password_changed");
  await revokeCurrentSession(c);
  return c.json({ ok: true, reauth_required: true });
});
