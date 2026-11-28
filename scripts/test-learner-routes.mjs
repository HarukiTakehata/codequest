#!/usr/bin/env node
// 学习端显式路由真实 Chromium 验收：静态产物 + 同源 API mock，覆盖深链接、前进/后退与登录回跳。
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "apps/web/dist");
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm", ".gz": "application/gzip", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    const candidate = resolve(dist, `.${pathname}`);
    if (!candidate.startsWith(`${dist}/`) && candidate !== dist) {
      res.writeHead(403).end();
      return;
    }
    let file = candidate;
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      if (extname(pathname)) {
        res.writeHead(404).end();
        return;
      }
      file = resolve(dist, "index.html");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    }).end(body);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const user = {
  id: "usr_learner", username: "learner", email: "learner@example.test",
  display_name: "学习者", role: "student", must_change_password: false,
};
const course = {
  id: "demo", slug: "demo", title: "路由验收课程", summary: "验证课程深链接",
  langs: ["javascript"], difficulty: "beginner", version: 1,
};
const state = { authenticated: false, packRequests: 0, progressRequests: 0 };
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const unauthorized = () => json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, 401);

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.C2W_BROWSER ?? process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("codequest-locale", "zh"));
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await context.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const body = () => { try { return req.postDataJSON(); } catch { return {}; } };
    let result;

    if (path === "/api/v1/setup/status") result = json({ needs_setup: false, instance_name: "路由验收实例", admin_url: "/admin/" });
    else if (path === "/api/v1/me") result = state.authenticated ? json({ user }) : unauthorized();
    else if (path === "/api/v1/auth/login" && method === "POST") {
      state.authenticated = true;
      result = json({ user });
    } else if (path === "/api/v1/auth/logout" && method === "POST") {
      state.authenticated = false;
      result = json({ ok: true });
    } else if (path === "/api/v1/courses") result = state.authenticated ? json({ courses: [course] }) : unauthorized();
    else if (path === "/api/v1/courses/demo/pack") {
      state.packRequests += 1;
      result = state.authenticated ? json({ pack: {
        "course.json": JSON.stringify({ entry: "start.txt" }),
        "start.txt": "导师:Deep link restored;\nend;",
      } }) : unauthorized();
    } else if (path === "/api/v1/progress/demo") {
      state.progressRequests += 1;
      result = state.authenticated ? json({ progress: {} }) : unauthorized();
    } else if (path === "/api/v1/freeform/javascript") {
      result = state.authenticated ? json({ draft: {
        lang: "javascript", code: "", stdin: "", testcases: [], updated_at: "2026-11-28T00:00:00.000Z",
      } }) : unauthorized();
    } else result = json({ error: { code: "NOT_FOUND", message: "not found" } }, 404);

    await route.fulfill(result);
  });
  await context.route("**/runtime/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"runtime unavailable in route test"}' }));

  await page.goto(`${origin}/free`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/login");
  await page.locator("#login-identifier").fill(user.username);
  await page.locator('input[type="password"]').fill("learner-password-123");
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByRole("heading", { name: /自由模式/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/free");
  assert.match(await page.title(), /自由模式/);
  console.log("PASS 未登录深链接门禁与登录后返回原目标页");

  await page.getByRole("button", { name: "课程库", exact: true }).click();
  await page.getByRole("heading", { name: /欢迎回来，学习者/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/courses");
  await page.goBack();
  await page.getByRole("heading", { name: /自由模式/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/free");
  await page.goForward();
  await page.getByRole("heading", { name: /欢迎回来，学习者/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/courses");
  console.log("PASS 页面切换同步 URL 且浏览器前进/后退恢复视图");

  await page.getByRole("link", { name: /路由验收课程/ }).click();
  await page.getByText("Deep link restored", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/courses/demo");
  const firstPackRequests = state.packRequests;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Deep link restored", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/courses/demo");
  assert.ok(state.packRequests > firstPackRequests);
  assert.ok(state.progressRequests >= 2);
  console.log("PASS 课程深链接刷新后重新拉取课程包与进度");

  await page.goto(`${origin}/container`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Container Shell/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/container");
  await page.goto(`${origin}/missing-page`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "页面不存在", exact: true }).waitFor();
  await page.getByRole("link", { name: "课程库", exact: true }).click();
  await page.getByRole("heading", { name: /欢迎回来，学习者/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/courses");
  console.log("PASS Container Shell 深链接与学习端 404 返回课程页");

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/login");
  await page.goto(`${origin}/courses/demo`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/login");
  await page.locator("#login-identifier").fill(user.username);
  await page.locator('input[type="password"]').fill("learner-password-123");
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByText("Deep link restored", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/courses/demo");
  assert.deepEqual(browserErrors, []);
  console.log("PASS 登出 URL、课程深链接登录回跳与无浏览器运行时错误");
  console.log("LEARNER_ROUTES_E2E_PASS");
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
