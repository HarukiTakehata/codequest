import { Hono } from "hono";
import type { AppEnv } from "./context";
import { HttpError } from "./lib/http-error";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { courseRoutes } from "./routes/courses";
import { freeformRoutes } from "./routes/freeform";
import { meRoutes } from "./routes/me";
import { progressRoutes } from "./routes/progress";
import { setupRoutes } from "./routes/setup";
import type { Env } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("X-Request-Id") ?? crypto.randomUUID().slice(0, 8));
    await next();
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    if (error instanceof HttpError) {
      c.header("X-Request-Id", requestId);
      return c.json({ error: { code: error.code, message: error.message, request_id: requestId } }, error.status as never);
    }
    console.error(JSON.stringify({ level: "error", path: c.req.path, message: String(error) }));
    c.header("X-Request-Id", requestId);
    return c.json({ error: { code: "INTERNAL", message: "internal server error", request_id: requestId } }, 500);
  });

  app.route("/api/v1", meRoutes);
  app.route("/api/v1", authRoutes);
  app.route("/api/v1", setupRoutes);
  app.route("/api/v1/admin", adminRoutes);
  app.route("/api/v1", courseRoutes);
  app.route("/api/v1", progressRoutes);
  app.route("/api/v1", freeformRoutes);

  // 设计书 §7.1 / boardroom 惯例：空实例访问根路径跳转到实例初始化页面。
  app.get("/", async (c) => {
    try {
      const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
      if ((row?.n ?? 0) === 0) return c.redirect("/setup");
    } catch {
      // 数据库不可用时交给 SPA，setup/status 会给出真实错误。
    }
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text("CodeQuest API — 前端资源未构建", 404);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: { code: "NOT_FOUND", message: "resource not found" } }, 404);
    }
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text("CodeQuest API — 前端资源未构建", 404);
  });

  return app;
}

export const app = createApp();
export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
