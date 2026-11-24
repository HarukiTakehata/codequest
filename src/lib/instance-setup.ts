import type { Context } from "hono";
import type { AppEnv } from "../context";
import type { Database } from "../db";
import { bootstrapClaim } from "./bootstrap";
import {
  assertCoursePackSize, prepareCoursePackWrite, validatePack,
  type CoursePack, type PreparedCoursePackWrite,
} from "./course";
import { HttpError } from "./http-error";
import { identityConflict, normalizeEmail, normalizeUsername } from "./identity";
import { newId } from "./ids";
import { hashPassword, validatePassword } from "./password";
import {
  authEventStatement, hashIp, prepareSession, requestFingerprint, setSessionCookie,
} from "./session";
import { nowIso } from "./time";
import { normalizeDisplayName } from "./user";
import type { CourseRow, UserRow } from "../types";

export interface InitializeInstanceInput {
  username: string;
  email?: string | null;
  password: string;
  displayName?: string;
  instanceName?: string;
  coursePack?: CoursePack;
}

/** 用户或 bootstrap claim 任一存在即视为已初始化，避免并发与半写入绕过。 */
export async function instanceUserCount(db: Database): Promise<number> {
  const row = await db.prepare(
    "SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM instance_settings WHERE k = 'bootstrap_claim') AS n",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** 唯一初始化入口 `/setup` 的服务实现。 */
export async function initializeInstance(
  c: Context<AppEnv>, input: InitializeInstanceInput,
): Promise<{ user: UserRow; instanceName: string }> {
  const db = c.get("db");
  if (await instanceUserCount(db) > 0) {
    throw new HttpError(409, "SETUP_COMPLETED", "实例已初始化");
  }
  let username: string;
  let email: string | null;
  try {
    username = normalizeUsername(input.username);
    email = normalizeEmail(input.email);
  } catch (error) {
    throw new HttpError(400, "INVALID_ARGUMENT", error instanceof Error ? error.message : "管理员账号参数不合法");
  }
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new HttpError(400, "INVALID_ARGUMENT", passwordError);
  // 课程包先完成大小与格式校验，避免超限/非法请求创建管理员或暂存 R2 对象。
  if (input.coursePack) {
    assertCoursePackSize(input.coursePack);
    validatePack(input.coursePack);
  }
  const instanceName = input.instanceName?.trim() || "CodeQuest";
  const now = nowIso();
  const user: UserRow = {
    id: newId("usr"), username, email,
    display_name: normalizeDisplayName(input.displayName), role: "admin", status: "active",
    password_hash: await hashPassword(input.password), password_updated_at: now,
    must_change_password: 0, auth_version: 1, last_seen_at: now, created_at: now,
  };
  const session = await prepareSession(c, user);
  const fp = requestFingerprint(c);
  const audit = authEventStatement(db, {
    userId: user.id, identifier: user.username, eventType: "bootstrap",
    ipHash: await hashIp(c, fp.ip), userAgent: fp.userAgent,
  }, now);

  let course: PreparedCoursePackWrite | undefined;
  if (input.coursePack) {
    const existing = await db.prepare("SELECT * FROM courses WHERE slug = ?1")
      .bind(validatePack(input.coursePack).meta.slug).first<CourseRow>();
    course = await prepareCoursePackWrite(c.env, db, input.coursePack, user.id, existing, newId("crs"));
  }

  try {
    const statements = [
      bootstrapClaim(db, user.id),
      db.prepare(`INSERT INTO users
        (id, username, email, display_name, role, status, password_hash, password_updated_at, must_change_password, last_seen_at, created_at)
        VALUES (?1, ?2, ?3, ?4, 'admin', 'active', ?5, ?6, 0, ?6, ?6)`)
        .bind(user.id, user.username, user.email, user.display_name, user.password_hash, now),
      db.prepare("INSERT OR REPLACE INTO instance_settings (k, v) VALUES ('instance_name', ?1)")
        .bind(instanceName),
      ...(course ? [course.statement] : []),
      audit,
      session.statement,
    ];
    const results = await db.batch(statements);
    const sessionIndex = statements.length - 1;
    if (results[0]!.changes !== 1 || results[1]!.changes !== 1 ||
      (course && results[3]!.changes !== 1) || results[sessionIndex]!.changes !== 1) {
      throw new Error("initialization did not commit exactly once");
    }
  } catch (error) {
    await course?.cleanup();
    const conflict = identityConflict(error);
    if (conflict) throw new HttpError(409, conflict.code, conflict.message);
    throw new HttpError(409, "SETUP_COMPLETED", "实例已初始化");
  }
  setSessionCookie(c, session.token);
  return { user, instanceName };
}
