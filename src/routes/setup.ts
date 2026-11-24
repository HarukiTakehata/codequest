import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { parseBody } from "../lib/http";
import { initializeInstance, instanceUserCount } from "../lib/instance-setup";
import { emailSchema, usernameSchema } from "../lib/identity";
import { publicUser } from "../lib/user";

export const setupRoutes = new Hono<AppEnv>();

export const setupSchema = z.object({
  instance_name: z.string().trim().min(1).max(120),
  admin: z.object({
    username: usernameSchema,
    email: emailSchema.optional(),
    display_name: z.string().max(120).optional(),
    password: z.string().min(10).max(200),
  }),
  /** 可选初始化内容；学习端课程接口当前固定为空，保留该入口供后续课程实现使用。 */
  course_pack: z.record(z.string(), z.string()).optional(),
});

setupRoutes.get("/setup/status", async (c) => {
  const db = c.get("db");
  const row = await db.prepare("SELECT v FROM instance_settings WHERE k = 'instance_name'").first<{ v: string }>();
  return c.json({
    needs_setup: (await instanceUserCount(db)) === 0,
    auth_mode: c.env.AUTH_MODE ?? "session",
    instance_name: row?.v ?? null,
    admin_url: c.env.ADMIN_URL?.trim() || "/admin/",
  });
});

setupRoutes.post("/setup", async (c) => {
  const body = await parseBody(c, setupSchema);
  const result = await initializeInstance(c, {
    username: body.admin.username,
    email: body.admin.email,
    password: body.admin.password,
    displayName: body.admin.display_name,
    instanceName: body.instance_name,
    coursePack: body.course_pack,
  });
  return c.json({ user: publicUser(result.user), instance_name: result.instanceName }, 201);
});

setupRoutes.get("/instance", async (c) => {
  const row = await c.get("db").prepare("SELECT v FROM instance_settings WHERE k = 'instance_name'").first<{ v: string }>();
  return c.json({ instance_name: row?.v ?? "CodeQuest" });
});
