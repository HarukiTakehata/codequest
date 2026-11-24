import { Hono } from "hono";
import type { AppEnv } from "../context";
import { getCourseProvider } from "../lib/course-provider";
import { HttpError } from "../lib/http-error";
import { requireUser } from "../middleware/identity";

export const courseRoutes = new Hono<AppEnv>();
courseRoutes.use("*", requireUser);

/**
 * 学习端课程接口只依赖通用 CourseProvider，不直接读取课程表、课程包或任何剧本格式。
 * 当前版本使用 DisabledCourseProvider：目录固定为空，详情/内容固定 404。
 */
courseRoutes.get("/courses", async (c) => {
  const courses = await getCourseProvider(c.env).list();
  return c.json({ courses });
});

courseRoutes.get("/courses/:id", async (c) => {
  const course = await getCourseProvider(c.env).get(c.req.param("id"));
  if (!course) throw new HttpError(404, "COURSE_NOT_FOUND", "课程不存在或未发布");
  return c.json({ course });
});

/** 整包签发：由 provider 决定内容格式，路由层不感知具体课程引擎。 */
courseRoutes.get("/courses/:id/pack", async (c) => {
  const pack = await getCourseProvider(c.env).pack(c.req.param("id"));
  if (!pack) throw new HttpError(404, "COURSE_NOT_FOUND", "课程不存在或未发布");
  c.header("Cache-Control", "private, no-store");
  return c.json({ pack });
});

/** 单文件接口：路径校验留在路由层，内容类型与文件内容由 provider 提供。 */
courseRoutes.get("/courses/:id/files/*", async (c) => {
  // Hono 的 `*` 通配符不进入 req.param()，从完整路径中取出相对路径。
  const path = c.req.path.split("/files/")[1] ?? "";
  if (!path || path.includes("..") || path.includes("\\")) throw new HttpError(400, "INVALID_PATH", "非法文件路径");
  const file = await getCourseProvider(c.env).file(c.req.param("id"), path);
  if (!file) throw new HttpError(404, "COURSE_NOT_FOUND", "课程不存在或未发布");
  c.header("Content-Type", file.contentType);
  c.header("Cache-Control", "private, no-store");
  return c.body(file.content);
});
