import { Hono } from "hono";
import type { AppEnv } from "../context";
import { publicCourse, readPack } from "../lib/course";
import { HttpError } from "../lib/http-error";
import { requireUser } from "../middleware/identity";
import type { CourseRow } from "../types";

export const courseRoutes = new Hono<AppEnv>();
courseRoutes.use("*", requireUser);

async function enabledCourse(db: D1Database, id: string): Promise<CourseRow> {
  const row = await db.prepare("SELECT * FROM courses WHERE id = ?1 AND enabled = 1").bind(id).first<CourseRow>();
  if (!row) throw new HttpError(404, "COURSE_NOT_FOUND", "课程不存在或未发布");
  return row;
}

function contentType(path: string): string {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".txt") || path.endsWith(".md") || path.endsWith(".sh")) return "text/plain; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

courseRoutes.get("/courses", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM courses WHERE enabled = 1 ORDER BY updated_at DESC").all<CourseRow>();
  return c.json({ courses: rows.results.map(publicCourse) });
});

courseRoutes.get("/courses/:id", async (c) => {
  return c.json({ course: publicCourse(await enabledCourse(c.env.DB, c.req.param("id"))) });
});

/** 整包签发（v0.2 决策 6）：登录后一次性拉全包，不做侧载。 */
courseRoutes.get("/courses/:id/pack", async (c) => {
  const pack = readPack(await enabledCourse(c.env.DB, c.req.param("id")));
  c.header("Cache-Control", "private, no-store");
  return c.json({ pack });
});

/** 单文件接口：供剧本按需加载资源；同样经过会话鉴权。 */
courseRoutes.get("/courses/:id/files/*", async (c) => {
  // Hono 的 `*` 通配符不进入 req.param()，从完整路径中取出相对路径。
  const path = c.req.path.split("/files/")[1] ?? "";
  if (!path || path.includes("..") || path.includes("\\")) throw new HttpError(400, "INVALID_PATH", "非法文件路径");
  const pack = readPack(await enabledCourse(c.env.DB, c.req.param("id")));
  const content = pack[path];
  if (content === undefined) throw new HttpError(404, "FILE_NOT_FOUND", "课程包中不存在该文件");
  c.header("Content-Type", contentType(path));
  c.header("Cache-Control", "private, no-store");
  return c.body(content);
});
