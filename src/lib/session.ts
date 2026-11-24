import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppEnv } from "../context";
import type { Database, DbStatement } from "../db";
import { randomSecret, sha256Hex } from "./crypto";
import { newId } from "./ids";
import { addDaysIso, nowIso } from "./time";
import type { UserRow } from "../types";
import { HttpError } from "./http-error";

const COOKIE_NAME = "codequest_session";
const TTL_DAYS = 7;

function isSecure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/** 独立子域部署时，把会话 Cookie 落到父域，供 admin./editor. 共用。 */
function sessionCookieDomain(c: Context<AppEnv>): string | undefined {
  const domain = c.env.SESSION_COOKIE_DOMAIN?.trim();
  return domain ? domain : undefined;
}

export interface PreparedSession {
  statement: DbStatement;
  token: string;
}

export async function prepareSession(c: Context<AppEnv>, user: UserRow): Promise<PreparedSession> {
  const token = randomSecret(32);
  const tokenHash = await sha256Hex(`${token}${c.env.TOKEN_PEPPER}`);
  const fp = requestFingerprint(c);
  const now = nowIso();
  const statement = c.get("db").prepare(
    `INSERT INTO user_sessions (id, user_id, token_hash, user_agent, ip_hash, created_at, last_seen_at, expires_at, auth_version)
     SELECT ?1, id, ?3, ?4, ?5, ?6, ?6, ?7, auth_version FROM users
      WHERE id = ?2 AND auth_version = ?8 AND status = 'active'`,
  ).bind(newId("ses"), user.id, tokenHash, fp.userAgent, await hashIp(c, fp.ip), now, addDaysIso(TTL_DAYS), user.auth_version);
  return { statement, token };
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  const domain = sessionCookieDomain(c);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, secure: isSecure(c), sameSite: "Lax", path: "/",
    maxAge: TTL_DAYS * 24 * 60 * 60,
    ...(domain ? { domain } : {}),
  });
}

export function requestFingerprint(c: Context<AppEnv>): { ip: string | null; userAgent: string | null } {
  return {
    ip: c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null,
    userAgent: c.req.header("User-Agent")?.slice(0, 300) ?? null,
  };
}

export async function hashIp(c: Context<AppEnv>, ip: string | null): Promise<string | null> {
  return ip ? sha256Hex(`${ip}${c.env.TOKEN_PEPPER}`) : null;
}

export async function createSession(c: Context<AppEnv>, user: UserRow): Promise<void> {
  const prepared = await prepareSession(c, user);
  const result = await prepared.statement.run();
  if (result.changes !== 1) throw new HttpError(401, "INVALID_CREDENTIALS", "凭据已变更，请重新登录");
  setSessionCookie(c, prepared.token);
}

export async function readSession(c: Context<AppEnv>): Promise<UserRow | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256Hex(`${token}${c.env.TOKEN_PEPPER}`);
  const user = await c.get("db").prepare(
    `SELECT u.* FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2
        AND s.auth_version = u.auth_version AND u.status = 'active'`,
  ).bind(tokenHash, nowIso()).first<UserRow>();
  if (!user) {
    clearSessionCookie(c);
    return null;
  }
  c.set("user", user);
  return user;
}

export async function revokeCurrentSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    const tokenHash = await sha256Hex(`${token}${c.env.TOKEN_PEPPER}`);
    await c.get("db").prepare(
      "UPDATE user_sessions SET revoked_at = ?1 WHERE token_hash = ?2 AND revoked_at IS NULL",
    ).bind(nowIso(), tokenHash).run();
  }
  clearSessionCookie(c);
}

export async function updatePassword(
  db: Database, user: UserRow, passwordHash: string, mustChange: boolean,
): Promise<void> {
  const now = nowIso();
  const results = await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?1, password_updated_at = ?2,
      must_change_password = ?3, auth_version = auth_version + 1
      WHERE id = ?4 AND auth_version = ?5`)
      .bind(passwordHash, now, mustChange ? 1 : 0, user.id, user.auth_version),
    db.prepare(`UPDATE user_sessions SET revoked_at = ?1
      WHERE user_id = ?2 AND revoked_at IS NULL AND changes() = 1`).bind(now, user.id),
  ]);
  if (results[0]!.changes !== 1) throw new HttpError(409, "CONFLICT", "凭据已变更，请重试");
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  const domain = sessionCookieDomain(c);
  deleteCookie(c, COOKIE_NAME, {
    path: "/",
    ...(domain ? { domain } : {}),
  });
}

export interface AuthEventInput {
  userId: string | null;
  identifier: string;
  eventType: string;
  ipHash?: string | null;
  userAgent?: string | null;
}

export function authEventStatement(db: Database, input: AuthEventInput, createdAt = nowIso()): DbStatement {
  return db.prepare(
    `INSERT INTO user_auth_events (user_id, identifier, event_type, ip_hash, user_agent, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(input.userId, input.identifier, input.eventType, input.ipHash ?? null, input.userAgent ?? null, createdAt);
}

export async function recordAuthEvent(db: Database, input: AuthEventInput): Promise<void> {
  await authEventStatement(db, input).run();
}
