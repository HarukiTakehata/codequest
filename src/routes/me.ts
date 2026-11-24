import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { requireUser } from "../middleware/identity";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { normalizeDisplayName, publicUser } from "../lib/user";

export const meRoutes = new Hono<AppEnv>();

const profileSchema = z.object({
  display_name: z.string().max(120).nullable().optional(),
});

meRoutes.get("/me", requireUser, (c) => c.json({ user: publicUser(c.get("user")) }));

/** 用户自助资料：目前只允许修改展示用显示名，用户名与邮箱仍由管理员维护。 */
meRoutes.patch("/me", requireUser, async (c) => {
  const body = await parseBody(c, profileSchema);
  if (body.display_name === undefined) throw new HttpError(400, "INVALID_ARGUMENT", "没有需要更新的资料");
  const user = c.get("user");
  const displayName = normalizeDisplayName(body.display_name);
  const result = await c.get("db").prepare(
    "UPDATE users SET display_name = ?1 WHERE id = ?2 AND auth_version = ?3",
  ).bind(displayName, user.id, user.auth_version).run();
  if (result.changes !== 1) throw new HttpError(409, "CONFLICT", "凭据已变更，请重新登录");
  user.display_name = displayName;
  return c.json({ user: publicUser(user) });
});

meRoutes.get("/health", (c) => c.json({ ok: true, service: "codequest" }));
