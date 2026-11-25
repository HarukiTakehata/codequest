import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { bootstrapClaim } from "../lib/bootstrap";
import { saveCoursePack, validatePack } from "../lib/course";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { newId } from "../lib/ids";
import { hashPassword, validatePassword } from "../lib/password";
import { createSession } from "../lib/session";
import { nowIso } from "../lib/time";
import type { UserRow } from "../types";
import { publicUser } from "./auth";

export const setupRoutes = new Hono<AppEnv>();

export const setupSchema = z.object({
  instance_name: z.string().min(1).max(120),
  admin: z.object({
    email: z.string().email(),
    display_name: z.string().max(120).optional(),
    password: z.string().min(10).max(200),
  }),
  /** 四步向导最后一步可选：初始化时一并上传课程包（手写 JSON）。 */
  course_pack: z.record(z.string()).optional(),
});

setupRoutes.get("/setup/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({
    needs_setup: (row?.n ?? 0) === 0,
    auth_mode: c.env.AUTH_MODE ?? "session",
    instance_name: (await c.env.DB.prepare("SELECT v FROM instance_settings WHERE k = 'instance_name'")
      .first<{ v: string }>())?.v ?? null,
  });
});

setupRoutes.post("/setup", async (c) => {
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) throw new HttpError(409, "SETUP_COMPLETED", "实例已初始化");
  const body = await parseBody(c, setupSchema);
  const passwordError = validatePassword(body.admin.password);
  if (passwordError) throw new HttpError(400, "INVALID_ARGUMENT", passwordError);
  const now = nowIso();
  const user: UserRow = {
    id: newId("usr"), email: body.admin.email.trim().toLowerCase(),
    display_name: body.admin.display_name?.trim() ?? null, role: "admin", status: "active",
    password_hash: await hashPassword(body.admin.password), password_updated_at: now,
    must_change_password: 0, auth_version: 1, last_seen_at: now, created_at: now,
  };
  try {
    const statements = [
      bootstrapClaim(c.env.DB, user.id),
      c.env.DB.prepare(`INSERT INTO users
        (id, email, display_name, role, status, password_hash, password_updated_at, must_change_password, last_seen_at, created_at)
        VALUES (?1, ?2, ?3, 'admin', 'active', ?4, ?5, 0, ?5, ?5)`)
        .bind(user.id, user.email, user.display_name, user.password_hash, now),
      c.env.DB.prepare("INSERT OR REPLACE INTO instance_settings (k, v) VALUES ('instance_name', ?1)")
        .bind(body.instance_name),
    ];
    // 课程包先校验再建管理员，避免外键约束与半写入（batch 原子性）。
    if (body.course_pack) validatePack(body.course_pack);
    await c.env.DB.batch(statements);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, "SETUP_COMPLETED", "实例已初始化");
  }
  if (body.course_pack) await saveCoursePack(c.env, body.course_pack, user.id);
  await createSession(c, user);
  return c.json({ user: publicUser(user), instance_name: body.instance_name }, 201);
});

setupRoutes.get("/instance", async (c) => {
  const row = await c.env.DB.prepare("SELECT v FROM instance_settings WHERE k = 'instance_name'").first<{ v: string }>();
  return c.json({ instance_name: row?.v ?? "CodeQuest" });
});
