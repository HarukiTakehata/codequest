#!/usr/bin/env node
// M6.1 管理面板真实 Chromium 验收：静态产物 + 同源 API mock，覆盖角色权限、关键交互与深链接。
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "apps/admin/dist");
const port = 5194;
const origin = `http://127.0.0.1:${port}`;
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    const candidate = resolve(dist, `.${pathname}`);
    if (!candidate.startsWith(`${dist}/`) && candidate !== dist) {
      res.writeHead(403).end(); return;
    }
    let file = candidate;
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      if (extname(pathname)) {
        res.writeHead(404).end(); return;
      }
      file = resolve(dist, "index.html");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-cache",
    }).end(body);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", done);
});

const admin = { id: "usr_admin", username: "admin", email: "admin@example.test", display_name: "管理员", role: "admin", status: "active", must_change_password: false };
const teacher = { id: "usr_teacher", username: "teacher", email: "teacher@example.test", display_name: "教研教师", role: "teacher", status: "active", must_change_password: false };
const student = { id: "usr_student", username: "student", email: "student@example.test", display_name: "学生", role: "student", status: "active", must_change_password: false };
const users = { admin, teacher, student };
const passwords = { admin: "admin-password-123", teacher: "teacher-password-123", student: "student-password-123" };
const instanceName = "CodeQuest 验收实例";
const state = {
  sessionRole: null,
  needsBootstrap: false,
  setupUrl: "/setup-target",
  accounts: [
    {
      id: "usr_admin", username: "admin", email: "admin@example.test", display_name: "管理员", role: "admin", status: "active",
      must_change_password: false, created_at: "2026-11-27T08:00:00.000Z", last_seen_at: "2026-11-27T08:00:00.000Z",
      password_updated_at: "2026-11-27T08:00:00.000Z", batch_id: null, batch_filename: null,
    },
    {
      id: "usr_alice", username: "alice", email: "alice@example.test", display_name: "Alice", role: "student", status: "active",
      must_change_password: true, created_at: "2026-11-27T08:00:00.000Z", last_seen_at: null,
      password_updated_at: "2026-11-27T08:00:00.000Z", batch_id: null, batch_filename: null,
    },
    {
      id: "usr_bob", username: "bob", email: null, display_name: "Bob", role: "student", status: "active",
      must_change_password: false, created_at: "2026-11-27T08:00:00.000Z", last_seen_at: null,
      password_updated_at: "2026-11-27T08:00:00.000Z", batch_id: null, batch_filename: null,
    },
    {
      id: "usr_teacher", username: "teacher", email: "teacher@example.test", display_name: "教研教师", role: "teacher", status: "active",
      must_change_password: false, created_at: "2026-11-27T08:00:00.000Z", last_seen_at: "2026-11-27T08:00:00.000Z",
      password_updated_at: "2026-11-27T08:00:00.000Z", batch_id: null, batch_filename: null,
    },
  ],
  batches: [], audits: [], courses: [{
    id: "crs_demo", slug: "demo", title: "演示课程", summary: "管理面板验收", langs: ["javascript"],
    difficulty: "beginner", entry: "start.txt", version: 1, bytes: 120, sha256: "a".repeat(64),
    enabled: true, created_at: "2026-11-27T08:00:00.000Z", updated_at: "2026-11-27T08:00:00.000Z",
  }],
  previewRequests: [], createRequests: [], accountPatches: [], passwordChanges: [],
};
const json = (body, status = 200, headers = {}) => ({ status, contentType: "application/json", body: JSON.stringify(body), headers });
const unauthorized = () => json({ error: { code: "UNAUTHENTICATED", message: "请先登录", request_id: "e2e" } }, 401);
const forbidden = () => json({ error: { code: "FORBIDDEN", message: "当前角色没有此操作权限", request_id: "e2e" } }, 403);
let requestCookie = "";
const sessionRole = () => state.sessionRole ?? (/cq_e2e=(admin|teacher|student)/.exec(requestCookie)?.[1] ?? null);
const currentUser = () => sessionRole() ? users[sessionRole()] : null;
const isAuthenticated = () => Boolean(currentUser());
const isStaff = () => currentUser()?.role === "admin" || currentUser()?.role === "teacher";
const isAdmin = () => currentUser()?.role === "admin";
const canManageAccount = (account) => isAdmin() || (currentUser()?.role === "teacher" && account.role === "student");
const visibleBatches = () => state.batches.filter((batch) => isAdmin() || batch.role === "student");
const batchView = (batch) => ({ ...batch, status: batch.downloaded_at ? "downloaded" : batch.revoked_at ? "revoked" : "pending" });
const audit = (action, targetType, targetId, metadata = {}) => {
  const actor = currentUser() ?? admin;
  state.audits.unshift({ id: `aud_${state.audits.length + 1}`, actor_id: actor.id, actor_username: actor.username, actor_email: actor.email, action, target_type: targetType, target_id: targetId, metadata, created_at: new Date().toISOString() });
};

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await context.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    requestCookie = req.headers().cookie ?? "";
    const authenticated = isAuthenticated();
    const body = () => { try { return req.postDataJSON(); } catch { return {}; } };
    let result;

    if (path === "/api/v1/auth/status") result = json({ needs_bootstrap: state.needsBootstrap, setup_url: state.setupUrl, registration_enabled: false });
    else if (path === "/api/v1/setup/status") result = json({ needs_setup: false, instance_name: instanceName });
    else if (path === "/api/v1/me" || path === "/api/v1/auth/me") result = authenticated ? json({ user: currentUser() }) : unauthorized();
    else if (path === "/api/v1/auth/login" && method === "POST") {
      const input = body();
      const identifier = String(input.identifier ?? "").trim().toLowerCase();
      const matched = Object.values(users).find((user) => user.username.toLowerCase() === identifier || user.email?.toLowerCase() === identifier);
      if (!matched || input.password !== passwords[matched.role]) result = json({ error: { code: "INVALID_CREDENTIALS", message: "用户名、邮箱或密码错误" } }, 401);
      else {
        state.sessionRole = matched.role;
        result = json({ user: matched }, 200, { "set-cookie": `cq_e2e=${matched.role}; Path=/; HttpOnly; SameSite=Lax` });
      }
    } else if (path === "/api/v1/auth/logout" && method === "POST") {
      state.sessionRole = null;
      result = json({ ok: true }, 200, { "set-cookie": "cq_e2e=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" });
    } else if (path === "/api/v1/auth/password" && method === "POST") {
      if (!authenticated) result = unauthorized();
      else {
        const input = body();
        const role = currentUser().role;
        if (input.current_password !== passwords[role]) {
          result = json({ error: { code: "CURRENT_PASSWORD_INCORRECT", message: "当前密码不正确", request_id: "e2e" } }, 401);
        } else if (String(input.new_password ?? "").length < 10 || input.new_password === input.current_password) {
          result = json({ error: { code: "INVALID_ARGUMENT", message: "新密码不合法", request_id: "e2e" } }, 400);
        } else {
          passwords[role] = input.new_password;
          state.passwordChanges.push({ role, current_password: input.current_password, new_password: input.new_password });
          state.sessionRole = null;
          result = json({ ok: true, reauth_required: true }, 200, { "set-cookie": "cq_e2e=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" });
        }
      }
    } else if (path === "/api/v1/admin/config") result = !authenticated ? unauthorized() : !isStaff() ? forbidden() : json({ instance_name: instanceName, editor_url: "https://editor.example.test", learner_url: "https://learn.example.test", download_link_ttl_hours: 24 });
    else if (path === "/api/v1/admin/overview") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const stats = (role) => {
          const accounts = state.accounts.filter((account) => account.role === role);
          return {
            total: accounts.length,
            active: accounts.filter((account) => account.status === "active").length,
            disabled: accounts.filter((account) => account.status === "disabled").length,
            password_change_required: accounts.filter((account) => account.must_change_password).length,
          };
        };
        result = json({
          accounts: stats("student"),
          teachers: stats("teacher"),
          courses: { total: state.courses.length, enabled: state.courses.filter((c) => c.enabled).length },
          batches: {
            pending: visibleBatches().filter((b) => !b.downloaded_at && !b.revoked_at).length,
            downloaded: visibleBatches().filter((b) => b.downloaded_at).length,
            expired: 0,
            revoked: visibleBatches().filter((b) => b.revoked_at).length,
          },
          recent_batches: visibleBatches().slice(0, 5).map(batchView),
          recent_audit: isAdmin() ? state.audits.slice(0, 5) : [],
        });
      }
    } else if (path === "/api/v1/admin/accounts/batch/preview" && method === "POST") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const input = body();
        const role = input.role ?? "student";
        state.previewRequests.push(input);
        if (!["student", "teacher"].includes(role) || (currentUser().role === "teacher" && role !== "student")) result = forbidden();
        else {
          const lines = input.csv.trim().split(/\r?\n/).filter((line) => line && !line.startsWith("username,"));
          const rows = lines.map((line) => {
            const [username, email, displayName, password] = line.split(",");
            return {
              username,
              email: email || null,
              display_name: displayName || username,
              password_mode: password ? "specified" : "generated",
            };
          });
          const specifiedCount = rows.filter((row) => row.password_mode === "specified").length;
          result = json({ filename: input.filename || "codequest-accounts.csv", count: rows.length, generated_count: rows.length - specifiedCount, specified_count: specifiedCount, rows, conflicts: [] });
        }
      }
    } else if (path === "/api/v1/admin/accounts/batch" && method === "POST") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const input = body();
        const role = input.role ?? "student";
        state.createRequests.push(input);
        if (!["student", "teacher"].includes(role) || (currentUser().role === "teacher" && role !== "student")) result = forbidden();
        else {
          const count = input.csv.trim().split(/\r?\n/).filter((line) => line && !line.startsWith("username,")).length;
          const batch = { id: `bat_e2e_${state.batches.length + 1}`, role, filename: input.filename || "codequest-accounts.csv", count, expires_at: "2026-11-28T08:00:00.000Z", downloaded_at: null, revoked_at: null, created_at: new Date().toISOString() };
          state.batches.unshift(batch);
          audit("batch_created", "issued_batch", batch.id, { count: batch.count, role });
          result = json({ batch: batchView(batch), download_url: "/api/v1/admin/accounts/download/e2e-one-time-token" }, 201);
        }
      }
    } else if (path === "/api/v1/admin/accounts/batches") {
      const batches = visibleBatches();
      result = !authenticated ? unauthorized() : !isStaff() ? forbidden() : json({ batches: batches.map(batchView), total: batches.length, limit: 20, offset: 0 });
    } else if (path.startsWith("/api/v1/admin/accounts/download/")) {
      const batch = state.batches.find((item) => !item.downloaded_at && !item.revoked_at);
      if (!batch) result = json({ error: { code: "LINK_EXPIRED", message: "发放链接无效或已被使用" } }, 404);
      else {
        batch.downloaded_at = new Date().toISOString();
        result = { status: 200, contentType: "text/csv; charset=utf-8", body: "username,email,display_name,password\nalice,alice@example.test,Alice,Cq!generated-password-123\nbob,,Bob,Cq!generated-password-456\n", headers: { "Content-Disposition": `attachment; filename="${batch.filename}"`, "Cache-Control": "no-store" } };
      }
    } else if (path === "/api/v1/admin/accounts") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const query = (url.searchParams.get("query") ?? "").toLowerCase();
        const requestedRole = url.searchParams.get("role");
        if (currentUser().role === "teacher" && requestedRole && requestedRole !== "student") result = forbidden();
        else {
          const role = currentUser().role === "teacher" ? "student" : requestedRole;
          const status = url.searchParams.get("status");
          const passwordState = url.searchParams.get("password_state");
          const scopedAccounts = currentUser().role === "teacher"
            ? state.accounts.filter((account) => account.role === "student")
            : state.accounts;
          const accounts = scopedAccounts.filter((a) => (!role || a.role === role) && (!query || `${a.username} ${a.email ?? ""} ${a.display_name ?? ""}`.toLowerCase().includes(query)) && (!status || a.status === status) && (!passwordState || (passwordState === "required" ? a.must_change_password : !a.must_change_password)));
          result = json({ accounts, total: accounts.length, limit: 20, offset: 0 });
        }
      }
    } else if (/^\/api\/v1\/admin\/accounts\/[^/]+\/password-reset$/.test(path) && method === "POST") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const id = path.split("/")[5];
        const account = state.accounts.find((item) => item.id === id);
        if (id === currentUser().id) result = json({ error: { code: "CANNOT_RESET_OWN_PASSWORD", message: "不能重置自己的密码，请使用个人资料自主改密", request_id: "e2e" } }, 403);
        else if (!account) result = json({ error: { code: "NOT_FOUND", message: "账号不存在" } }, 404);
        else if (!canManageAccount(account)) result = forbidden();
        else {
          account.must_change_password = true;
          audit("password_reset", "user", id);
          result = json({ temporary_password: "Cq!reset-password-123", must_change_password: true });
        }
      }
    } else if (/^\/api\/v1\/admin\/accounts\/[^/]+$/.test(path) && method === "PATCH") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const id = path.split("/")[5];
        const account = state.accounts.find((item) => item.id === id);
        const patch = body();
        if (!account) result = json({ error: { code: "NOT_FOUND", message: "账号不存在" } }, 404);
        else if (!canManageAccount(account) || (currentUser().role === "teacher" && patch.role === "teacher")) result = forbidden();
        else {
          Object.assign(account, patch);
          state.accountPatches.push({ actor: currentUser().role, id, patch });
          audit("account_updated", "user", id, patch);
          result = json({ account });
        }
      }
    } else if (path === "/api/v1/admin/courses" && method === "POST") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const meta = JSON.parse(body().pack["course.json"]);
        const course = { id: "crs_e2e", slug: meta.slug, title: meta.title, summary: meta.summary ?? "", langs: meta.langs ?? [], difficulty: meta.difficulty ?? "beginner", entry: meta.entry ?? "start.txt", version: 1, bytes: 100, sha256: "b".repeat(64), enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        state.courses.unshift(course);
        audit("course_published", "course", course.id, { slug: course.slug });
        result = json({ course }, 201);
      }
    } else if (path === "/api/v1/admin/courses") result = !authenticated ? unauthorized() : !isStaff() ? forbidden() : json({ courses: state.courses });
    else if (/^\/api\/v1\/admin\/courses\/[^/]+$/.test(path) && method === "PATCH") {
      if (!authenticated) result = unauthorized();
      else if (!isStaff()) result = forbidden();
      else {
        const course = state.courses.find((item) => item.id === path.split("/")[5]);
        course.enabled = body().enabled;
        audit("course_updated", "course", course.id, { enabled: course.enabled });
        result = json({ course });
      }
    } else if (path === "/api/v1/admin/audit") result = !authenticated ? unauthorized() : !isAdmin() ? forbidden() : json({ events: state.audits, total: state.audits.length, limit: 20, offset: 0 });
    else result = json({ error: { code: "NOT_FOUND", message: `unhandled ${method} ${path}` } }, 404);

    await route.fulfill(result);
  });

  await page.goto(`${origin}/accounts`, { waitUntil: "networkidle" });
  const loginIdentifier = page.locator("#login-identifier");
  assert.equal(await loginIdentifier.getAttribute("type"), "text");
  assert.equal(await loginIdentifier.getAttribute("autocomplete"), "username");
  await loginIdentifier.fill(admin.username);
  await page.locator('input[type="password"]').fill("admin-password-123");
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByText("概览", { exact: true }).first().waitFor();
  const workspace = page.locator(".workspace-chip");
  await workspace.getByText(instanceName, { exact: true }).waitFor();
  assert.equal(await workspace.getByText("学习系统", { exact: true }).count(), 0);
  assert.equal(await workspace.getByText("在线", { exact: true }).count(), 0);
  await workspace.getByText("管理员", { exact: true }).waitFor();
  await page.waitForFunction(() => document.title === "账号管理 · CodeQuest · 管理面板");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  const languageToggle = page.getByTestId("language-switcher");
  assert.equal(await languageToggle.count(), 1);
  assert.equal(await languageToggle.getAttribute("aria-label"), "切换语言");
  assert.equal(await languageToggle.getAttribute("aria-haspopup"), "menu");
  assert.equal(await languageToggle.getAttribute("aria-expanded"), "false");
  assert.equal((await languageToggle.innerText()).trim(), "");
  assert.equal(await languageToggle.locator("svg.lucide-globe-2").count(), 1);
  assert.equal(await languageToggle.locator("svg").count(), 1);
  assert.equal(await page.locator(".language-current").count(), 0);
  assert.equal(await page.locator("svg.lucide-chevron-down").count(), 0);
  await page.screenshot({ path: "/tmp/opencode/codequest-admin-dashboard.png", fullPage: true });
  console.log("PASS 管理员用户名登录与鉴权门禁");
  console.log("PASS 工作区显示真实实例名且不展示硬编码在线状态");

  await page.locator(".topbar-profile").click();
  const profileDialog = page.getByRole("dialog");
  await profileDialog.getByRole("heading", { name: "用户信息", exact: true }).waitFor();
  await profileDialog.getByRole("heading", { name: "修改密码", exact: true }).waitFor();
  await profileDialog.locator("#profile-current-password").fill("wrong-password-123");
  await profileDialog.locator("#profile-new-password").fill("admin-ready-password-123");
  await profileDialog.locator("#profile-confirm-password").fill("admin-ready-password-123");
  await profileDialog.getByRole("button", { name: "更新密码", exact: true }).click();
  await profileDialog.getByText("当前密码不正确。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "欢迎回来", exact: true }).count(), 0);
  await profileDialog.locator("#profile-current-password").fill("admin-password-123");
  await profileDialog.locator("#profile-confirm-password").fill("different-password-123");
  await profileDialog.getByRole("button", { name: "更新密码", exact: true }).click();
  await profileDialog.getByText("两次输入的新密码不一致。", { exact: true }).waitFor();
  await profileDialog.locator("#profile-confirm-password").fill("admin-ready-password-123");
  await profileDialog.getByRole("button", { name: "更新密码", exact: true }).click();
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  assert.equal(state.passwordChanges.at(-1)?.role, "admin");
  assert.equal(state.passwordChanges.at(-1)?.new_password, "admin-ready-password-123");
  assert.equal(passwords.admin, "admin-ready-password-123");
  await page.getByText("密码已更新，请使用新密码重新登录。", { exact: true }).waitFor();
  await page.locator("#login-identifier").fill(admin.username);
  await page.locator('input[type="password"]').fill("admin-ready-password-123");
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByText("概览", { exact: true }).first().waitFor();
  console.log("PASS 管理员个人资料自助改密、确认校验、会话失效与重新登录");

  await page.getByText("批量发号", { exact: true }).first().click();
  const csvInput = page.locator("textarea").first();
  await csvInput.fill("username,email,display_name,password\nalice,alice@example.test,Alice,\nbob,,Bob,\n");
  await page.getByRole("button", { name: /检查名单/ }).click();
  await page.getByText(/有效账号/).first().waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /确认并创建账号/ }).click();
  await page.getByRole("heading", { name: /已创建 2 个学生账号/ }).waitFor();
  assert.equal(state.previewRequests.at(-1)?.role, "student");
  assert.equal(state.createRequests.at(-1)?.role, "student");
  await page.screenshot({ path: "/tmp/opencode/codequest-admin-issuance.png", fullPage: true });
  const downloadPromise = context.waitForEvent("download");
  await page.getByRole("link", { name: /打开并下载发放表/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath);
  const csv = await readFile(downloadPath, "utf8");
  assert.match(csv, /^username,email,display_name,password/);
  assert.match(csv, /alice,alice@example\.test,Alice,/);
  assert.match(csv, /bob,,Bob,/);
  console.log("PASS CSV 预览、确认发号与一次性发放表下载");

  await page.getByText("账号管理", { exact: true }).first().click();
  await page.getByPlaceholder(/搜索用户名、邮箱或显示名称/).fill("alice");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("alice@example.test", { exact: true }).waitFor();
  const aliceRow = page.getByRole("row").filter({ hasText: "alice@example.test" });
  await aliceRow.getByRole("button", { name: "停用", exact: true }).click();
  const disableDialog = page.getByRole("dialog");
  await disableDialog.getByRole("button", { name: /确认停用|停用账号/ }).click();
  await aliceRow.getByText("已停用", { exact: true }).waitFor();
  await aliceRow.getByRole("button", { name: "重置密码", exact: true }).click();
  const resetDialog = page.getByRole("dialog");
  await resetDialog.getByRole("button", { name: "生成临时密码" }).click();
  const temporaryDialog = page.getByRole("dialog");
  await temporaryDialog.locator("#temporary-password").waitFor();
  assert.equal(await temporaryDialog.locator("#temporary-password").inputValue(), "Cq!reset-password-123");
  await temporaryDialog.getByRole("button", { name: "我已安全保存" }).click();
  console.log("PASS 账号搜索、停用与一次性临时密码展示");

  // 通用账号管理展示管理员本人，但本人仍不提供重置密码入口。
  await page.getByPlaceholder(/搜索用户名、邮箱或显示名称/).fill("");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("4 位账号", { exact: true }).waitFor();
  assert.equal(await page.getByRole("row").filter({ hasText: admin.email }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "重置密码", exact: true }).count(), 3);
  assert.match(await page.locator(".accounts-heading .badge").innerText(), /4 位账号/);
  for (const identifier of [admin.username, admin.email]) {
    await page.getByPlaceholder(/搜索用户名、邮箱或显示名称/).fill(identifier);
    const [searchResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/v1/admin/accounts?") && response.request().method() === "GET"),
      page.getByRole("button", { name: "搜索", exact: true }).click(),
    ]);
    assert.equal(searchResponse.ok(), true);
    await page.locator(".accounts-heading .badge").filter({ hasText: "1 位账号" }).waitFor();
    await page.getByRole("row").filter({ hasText: admin.email }).waitFor();
    assert.equal(await page.getByRole("row").filter({ hasText: admin.email }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "重置密码", exact: true }).count(), 0);
    assert.match(await page.locator(".accounts-heading .badge").innerText(), /1 位账号/);
  }
  const selfReset = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/admin/accounts/${id}/password-reset`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  }, admin.id);
  assert.equal(selfReset.status, 403);
  assert.equal(selfReset.body.error.code, "CANNOT_RESET_OWN_PASSWORD");
  assert.equal(state.audits.some((event) => event.action === "account_password_reset" && event.target_id === admin.id), false);
  await page.getByPlaceholder(/搜索用户名、邮箱或显示名称/).fill("");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("4 位账号", { exact: true }).waitFor();
  console.log("PASS 通用账号列表、管理员搜索与自重置 403 防线");

  const bobRow = page.getByRole("row").filter({ hasText: "bob" });
  await bobRow.waitFor();
  await bobRow.getByText("未设置邮箱", { exact: true }).waitFor();
  await bobRow.getByRole("button", { name: "编辑账号", exact: true }).click();
  const bobEditDialog = page.getByRole("dialog");
  assert.equal(await bobEditDialog.locator("#account-username").inputValue(), "bob");
  assert.equal(await bobEditDialog.locator("#account-email").inputValue(), "");
  await bobEditDialog.locator("#account-username").fill("bob_updated");
  await bobEditDialog.getByRole("button", { name: "保存更改", exact: true }).click();
  await bobRow.getByText("bob_updated", { exact: true }).waitFor();
  assert.equal(state.accountPatches.at(-1)?.patch.username, "bob_updated");
  assert.equal(state.accountPatches.at(-1)?.patch.email, null);
  console.log("PASS 无邮箱账号显示与用户名编辑");

  await page.locator("#account-role-filter").selectOption("teacher");
  const teacherAccountRow = page.getByRole("row").filter({ hasText: "teacher@example.test" });
  await teacherAccountRow.waitFor();
  assert.equal(await page.getByRole("row").filter({ hasText: "alice@example.test" }).count(), 0);
  await page.locator("#account-role-filter").selectOption("admin");
  const adminAccountRow = page.getByRole("row").filter({ hasText: admin.email });
  await adminAccountRow.waitFor();
  assert.equal(await page.getByRole("row").filter({ hasText: "teacher@example.test" }).count(), 0);
  await page.locator("#account-role-filter").selectOption("");
  await teacherAccountRow.getByRole("button", { name: "编辑账号", exact: true }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.locator("#account-role").selectOption("student");
  await editDialog.getByRole("button", { name: "保存更改", exact: true }).click();
  await teacherAccountRow.getByText("学生", { exact: true }).waitFor();
  assert.equal(state.accountPatches.at(-1)?.patch.role, "student");
  await teacherAccountRow.getByRole("button", { name: "编辑账号", exact: true }).click();
  await page.getByRole("dialog").locator("#account-role").selectOption("teacher");
  await page.getByRole("dialog").getByRole("button", { name: "保存更改", exact: true }).click();
  await teacherAccountRow.getByText("教师", { exact: true }).waitFor();
  assert.equal(state.accountPatches.at(-1)?.patch.role, "teacher");
  console.log("PASS 管理员角色筛选与角色编辑");

  await page.getByText("课程管理", { exact: true }).first().click();
  await page.getByText("当前版本暂不提供课程", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "上传课程包", exact: true }).count(), 0);
  console.log("PASS 课程页固定无课且不提供上传入口");

  assert.ok(await page.getByRole("link", { name: "审计记录", exact: true }).count() > 0);
  await page.getByText("审计记录", { exact: true }).first().click();
  await page.getByText("batch_created", { exact: true }).first().waitFor();
  await page.getByText("password_reset", { exact: true }).first().waitFor();
  console.log("PASS 管理审计记录");

  await languageToggle.click();
  const chineseLanguageMenu = page.getByRole("menu", { name: "语言", exact: true });
  await chineseLanguageMenu.waitFor();
  assert.equal(await languageToggle.getAttribute("aria-expanded"), "true");
  assert.ok(await languageToggle.getAttribute("aria-controls"));
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.waitForFunction(() => document.title === "Audit log · CodeQuest · Admin");
  assert.equal((await languageToggle.innerText()).trim(), "");
  assert.equal(await languageToggle.getAttribute("aria-label"), "Switch language");
  assert.equal(await page.locator(".language-current").count(), 0);
  assert.equal(await page.locator("svg.lucide-chevron-down").count(), 0);
  await page.getByRole("heading", { name: "Audit log", exact: true }).waitFor();
  await page.getByText("Create issuance batch", { exact: true }).first().waitFor();
  await page.getByText("Reset temporary password", { exact: true }).first().waitFor();
  await page.getByRole("link", { name: "Account management", exact: true }).click();
  await page.getByRole("heading", { name: "Account management", exact: true }).waitFor();
  await page.getByPlaceholder("Search username, email, or display name").waitFor();
  const englishAliceRow = page.getByRole("row").filter({ hasText: "alice@example.test" });
  const expectedEnglishDate = await page.evaluate(() => new Intl.DateTimeFormat("en", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date("2026-11-27T08:00:00.000Z")));
  assert.ok((await englishAliceRow.innerText()).includes(expectedEnglishDate), "账号日期应使用英文格式");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Account management", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en", "刷新后应保留已保存的语言");
  await page.locator('.sidebar-nav a[href="/batches"]').click();
  await page.getByRole("heading", { name: "Batch account issuance", exact: true }).waitFor();
  await page.getByRole("button", { name: "Download template", exact: true }).waitFor();
  await page.getByText("CSV content", { exact: true }).waitFor();
  await languageToggle.click();
  await page.getByRole("menu", { name: "Language", exact: true }).waitFor();
  await page.getByRole("menuitemradio", { name: "中文", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  await page.waitForFunction(() => document.title === "批量发号 · CodeQuest · 管理面板");
  await page.getByRole("heading", { name: "批量发放账号", exact: true }).waitFor();
  await page.getByRole("button", { name: "下载模板", exact: true }).waitFor();
  await languageToggle.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menu", { name: "语言", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitemradio");
  await page.keyboard.press("ArrowDown");
  assert.equal((await page.evaluate(() => document.activeElement?.textContent?.trim())), "中文");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu", { name: "语言", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-language-toggle")), true);
  await languageToggle.click();
  await page.getByRole("menu", { name: "语言", exact: true }).waitFor();
  await page.getByRole("heading", { name: "批量发放账号", exact: true }).click();
  assert.equal(await page.getByRole("menu", { name: "语言", exact: true }).count(), 0);
  console.log("PASS 单图标语言切换、导航/账号/发号/审计文案、日期、持久化与键盘交互");

  await page.goto(`${origin}/courses`, { waitUntil: "networkidle" });
  await page.getByText("当前版本暂不提供课程", { exact: true }).waitFor();
  await page.goto(`${origin}/courses/`, { waitUntil: "networkidle" });
  await page.getByText("当前版本暂不提供课程", { exact: true }).waitFor();
  const storedKeys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
  assert.ok(!storedKeys.some((key) => /password|token|session/i.test(key)), `敏感信息落盘: ${storedKeys.join(",")}`);
  assert.equal(await page.evaluate(() => document.cookie.includes("e2e-one-time-token")), false);
  assert.deepEqual(browserErrors, []);
  console.log("PASS SPA 深链接、无敏感信息落盘、无浏览器运行时错误");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航菜单" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("link", { name: /账号管理/ }).click();
  await page.getByRole("heading", { name: "账号管理", exact: true }).waitFor();
  assert.equal(await page.getByTestId("language-switcher").isVisible(), true);
  await page.getByTestId("language-switcher").click();
  await page.getByRole("menu", { name: "语言", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu", { name: "语言", exact: true }).count(), 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `移动端横向溢出 ${overflow}px`);
  await page.screenshot({ path: "/tmp/opencode/codequest-admin-mobile.png", fullPage: true });
  console.log("PASS 移动端抽屉导航与无横向溢出");

  await page.getByRole("button", { name: "退出登录", exact: true }).last().click();
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  await page.goto(`${origin}/audit`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  console.log("PASS 登出与未登录深链接门禁");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/audit`, { waitUntil: "networkidle" });
  await page.locator("#login-identifier").fill(teacher.email);
  await page.locator('input[type="password"]').fill(passwords.teacher);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByRole("heading", { name: "欢迎回来，教师", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/overview");
  await page.locator(".workspace-chip").getByText("教师", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "审计记录", exact: true }).count(), 0);
  assert.equal(await page.getByText("最近审计", { exact: true }).count(), 0);
  const teacherAudit = await page.evaluate(async () => (await fetch("/api/v1/admin/audit")).status);
  assert.equal(teacherAudit, 403);
  const teacherConfig = await page.evaluate(async () => (await fetch("/api/v1/admin/config")).status);
  assert.equal(teacherConfig, 200);
  const teacherManageTeacher = await page.evaluate(async (id) => (await fetch(`/api/v1/admin/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "越权修改", role: "student" }),
  })).status, teacher.id);
  assert.equal(teacherManageTeacher, 403);
  console.log("PASS 教师邮箱登录、审计深链接重定向与审计接口拒绝");

  await page.getByRole("link", { name: "账号管理", exact: true }).click();
  await page.locator("#account-role-filter").waitFor();
  assert.equal(await page.locator("#account-role-filter").isDisabled(), true);
  assert.equal(await page.locator("#account-role-filter").inputValue(), "student");
  const teacherBobRow = page.getByRole("row").filter({ hasText: "bob_updated" });
  await teacherBobRow.waitFor();
  assert.equal(await page.getByRole("row").filter({ hasText: teacher.email }).count(), 0);
  await teacherBobRow.getByRole("button", { name: "编辑账号", exact: true }).click();
  const teacherEditDialog = page.getByRole("dialog");
  await teacherEditDialog.locator("#account-username").waitFor();
  assert.equal(await teacherEditDialog.locator("#account-email").inputValue(), "");
  assert.equal(await teacherEditDialog.locator("#account-role").count(), 0);
  await teacherEditDialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("link", { name: "课程管理", exact: true }).click();
  await page.getByRole("heading", { name: "课程管理", exact: true }).waitFor();
  await page.getByText("批量发号", { exact: true }).first().click();
  assert.equal(await page.locator("#batch-role").isDisabled(), true);
  assert.equal(await page.locator("#batch-role").inputValue(), "student");
  await page.locator("#batch-csv").fill("username,email,display_name,password\nteacher-created,teacher-created@example.test,Teacher Created,\n");
  await page.getByRole("button", { name: /检查名单/ }).click();
  await page.getByText(/有效账号/).first().waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /确认并创建账号/ }).click();
  await page.getByRole("heading", { name: /已创建 1 个学生账号/ }).waitFor();
  assert.equal(state.previewRequests.at(-1)?.role, "student");
  assert.equal(state.createRequests.at(-1)?.role, "student");
  const teacherBatchRole = await page.evaluate(async () => (await fetch("/api/v1/admin/accounts/batch/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv: "username,email,display_name,password\nblocked,blocked@example.test,Blocked,\n", role: "teacher" }),
  })).status);
  assert.equal(teacherBatchRole, 403);
  console.log("PASS 教师仅可查看和管理学生、课程与学生发号");

  await page.getByRole("button", { name: "退出登录", exact: true }).last().click();
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
  await page.locator("#login-identifier").fill(student.username);
  await page.locator('input[type="password"]').fill(passwords.student);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByRole("heading", { name: "学生账号不能访问管理面板", exact: true }).waitFor();
  await page.getByText("学生账号仅用于学习端", { exact: false }).waitFor();
  assert.equal(await page.getByRole("link", { name: "账号管理", exact: true }).count(), 0);
  const studentConfig = await page.evaluate(async () => (await fetch("/api/v1/admin/config")).status);
  assert.equal(studentConfig, 403);
  await page.getByRole("button", { name: "退出当前账号", exact: true }).click();
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
  assert.deepEqual(browserErrors, []);
  console.log("PASS 学生用户名登录进入禁止页且管理接口拒绝");

  state.needsBootstrap = true;
  state.sessionRole = null;
  await context.clearCookies();
  let setupRedirects = 0;
  await context.route(`${origin}/setup-target`, async (route) => {
    setupRedirects += 1;
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body><h1>唯一初始化入口</h1></body></html>" });
  });
  await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "唯一初始化入口", exact: true }).waitFor();
  assert.equal(setupRedirects, 1);
  assert.equal(new URL(page.url()).pathname, "/setup-target");
  console.log("PASS 空实例管理面板跳转唯一学习端初始化入口");
  console.log("ADMIN_PANEL_E2E_PASS");
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
