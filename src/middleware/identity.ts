import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context";
import { HttpError } from "../lib/http-error";
import { readSession } from "../lib/session";

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  "/api/v1/auth/me",
  "/api/v1/auth/password",
  "/api/v1/auth/logout",
]);

/** 未登录 → 401；临时密码未改 → 仅放行改密/登出/读取自身信息。 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "请先登录");
  if (user.must_change_password === 1) {
    const readOwnProfile = c.req.method === "GET" && c.req.path === "/api/v1/me";
    if (!readOwnProfile && !PASSWORD_CHANGE_ALLOWED_PATHS.has(c.req.path)) {
      throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改初始密码");
    }
  }
  await next();
});

export const requireStaff = createMiddleware<AppEnv>(async (c, next) => {
  const role = c.get("user").role;
  if (role !== "teacher" && role !== "admin") throw new HttpError(403, "FORBIDDEN", "需要教师或管理员权限");
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") throw new HttpError(403, "FORBIDDEN", "需要管理员权限");
  await next();
});
