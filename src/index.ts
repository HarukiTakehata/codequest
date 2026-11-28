import { Hono, type Context } from "hono";
import type { AppEnv } from "./context";
import { createDatabase } from "./db";
import { HttpError } from "./lib/http-error";
import { clearExpiredIssuedBatchCredentials } from "./lib/issued-batches";
import { instanceUserCount } from "./lib/instance-setup";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { courseRoutes } from "./routes/courses";
import { freeformRoutes } from "./routes/freeform";
import { meRoutes } from "./routes/me";
import { progressRoutes } from "./routes/progress";
import { runtimeRoutes } from "./routes/runtime-assets";
import { setupRoutes } from "./routes/setup";
import type { Env } from "./types";

const ADMIN_SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
} as const;

function applyAdminSecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}

async function learnerPage(c: Context<AppEnv>): Promise<Response> {
  if (!c.env.ASSETS) return c.text("学习端未构建，请先运行 npm run build。", 404);
  const response = await c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url), {
    headers: c.req.raw.headers,
  }));
  if (!response.ok) return c.text("学习端未构建，请先运行 npm run build。", 404);
  const html = await response.text();
  if (!html.includes('name="codequest-app" content="learner"')) {
    return c.text("学习端未构建，请先运行 npm run build。", 404);
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(html, { status: 200, headers });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("X-Request-Id") ?? crypto.randomUUID().slice(0, 8));
    c.set("db", createDatabase(c.env.DB));
    if (c.req.path.startsWith("/api/")) {
      // 登录、管理列表与凭证响应不得进入浏览器/代理缓存，下载 token 不进入 Referer。
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("X-Frame-Options", "DENY");
    }
    if (c.req.path === "/admin" || c.req.path.startsWith("/admin/")
      || c.req.path === "/editor" || c.req.path.startsWith("/editor/")) {
      // /admin/* 与 /editor/* 由 Worker 返回，不能依赖静态资源 _headers。
      for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) c.header(name, value);
    }
    await next();
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    if (error instanceof HttpError) {
      c.header("X-Request-Id", requestId);
      return c.json({ error: { code: error.code, message: error.message, request_id: requestId } }, error.status as never);
    }
    const path = c.req.path.replace(
      /^(\/api\/v1\/admin\/accounts\/download\/)[^/]+$/,
      "$1[redacted]",
    );
    console.error(JSON.stringify({ level: "error", path, message: String(error) }));
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
  app.route("/", runtimeRoutes);

  // 同源 /admin/ 嵌入管理面板；深层路由回退到管理端 index，而不是学习端 SPA。
  app.get("/admin", (c) => c.redirect("/admin/"));
  app.get("/admin/*", async (c) => {
    if (!c.env.ASSETS) return c.text("管理面板未构建，请先运行 npm run build。", 404);
    const path = c.req.path;
    const asset = path !== "/admin/index.html" && /^\/admin\/(?:assets(?:\/|$)|[^/]+\.[^/]+$)/.test(path);
    const target = asset ? path : "/admin/index.html";
    const response = await c.env.ASSETS.fetch(new Request(new URL(target, c.req.url), {
      headers: c.req.raw.headers,
    }));
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return c.text(asset ? "管理面板资源不存在，请先运行 npm run build。" : "管理面板未构建，请先运行 npm run build。", 404);
    }
    if (asset && contentType.includes("text/html")) {
      return c.text("管理面板资源不存在，请先运行 npm run build。", 404);
    }
    if (asset) {
      const headers = applyAdminSecurityHeaders(new Headers(response.headers));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const html = await response.text();
    if (!html.includes('name="codequest-app" content="admin"')) {
      return c.text("管理面板未构建，请先运行 npm run build。", 404);
    }
    const headers = applyAdminSecurityHeaders(new Headers(response.headers));
    headers.set("Cache-Control", "no-cache");
    return new Response(html, { status: 200, headers });
  });

  // 同源 /editor/ 嵌入 RPGJS 自建地图编辑器；深层路由只回退到编辑器 index。
  app.get("/editor", (c) => c.redirect("/editor/"));
  app.get("/editor/*", async (c) => {
    if (!c.env.ASSETS) return c.text("地图编辑器未构建，请先运行 npm run build。", 404);
    const path = c.req.path;
    const asset = path !== "/editor/index.html" && /^\/editor\/(?:assets(?:\/|$)|[^/]+\.[^/]+$)/.test(path);
    const target = asset ? path : "/editor/index.html";
    const response = await c.env.ASSETS.fetch(new Request(new URL(target, c.req.url), {
      headers: c.req.raw.headers,
    }));
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return c.text(asset ? "地图编辑器资源不存在，请先运行 npm run build。" : "地图编辑器未构建，请先运行 npm run build。", 404);
    }
    if (asset && contentType.includes("text/html")) {
      return c.text("地图编辑器资源不存在，请先运行 npm run build。", 404);
    }
    if (asset) {
      const headers = applyAdminSecurityHeaders(new Headers(response.headers));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const html = await response.text();
    if (!html.includes('name="codequest-app" content="editor"')) {
      return c.text("地图编辑器未构建，请先运行 npm run build。", 404);
    }
    const headers = applyAdminSecurityHeaders(new Headers(response.headers));
    headers.set("Cache-Control", "no-cache");
    return new Response(html, { status: 200, headers });
  });

  // 学习端显式页面路由：深层导航统一返回学习端 index，课程内容仍只走鉴权 API。
  for (const path of ["/setup", "/login", "/password", "/courses", "/courses/*", "/free", "/container"]) {
    app.get(path, learnerPage);
  }

  // 设计书 §7.1 / boardroom 惯例：空实例访问根路径跳转到实例初始化页面。
  app.get("/", async (c) => {
    try {
      if ((await instanceUserCount(c.get("db"))) === 0) return c.redirect("/setup");
    } catch {
      // 数据库不可用时交给 SPA，setup/status 会给出真实错误。
    }
    return learnerPage(c);
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

async function scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
  context.waitUntil(clearExpiredIssuedBatchCredentials(createDatabase(env.DB)).catch((error) => {
    console.error(JSON.stringify({ level: "error", job: "purge-expired-issuance", message: String(error) }));
  }));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
