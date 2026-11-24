import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context";
import { HttpError } from "../lib/http-error";
import { readSession } from "../lib/session";

/** 未登录 → 401；临时密码未改 → 仅放行改密/登出/读取自身信息。 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "请先登录");
  if (user.must_change_password === 1) {
    const path = c.req.path;
    const allowed = path.endsWith("/auth/me") || path.endsWith("/auth/password") || path.endsWith("/auth/logout");
    if (!allowed) throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改初始密码");
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") throw new HttpError(403, "FORBIDDEN", "需要管理员权限");
  await next();
});
