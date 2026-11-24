#!/usr/bin/env node
// 在空的本地 Wrangler D1 上验证真实 Worker/D1 发号链路。禁止指向非本地地址。
import assert from "node:assert/strict";

const base = process.env.ADMIN_API_URL ?? "http://127.0.0.1:8787";
const parsedBase = new URL(base);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsedBase.hostname), "仅允许本地 API");
assert.equal(process.env.ADMIN_SMOKE_ALLOW_WRITE, "1", "必须设置 ADMIN_SMOKE_ALLOW_WRITE=1，且只对空的本地数据库运行");

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return response;
}
async function json(response) {
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true, "响应应为 JSON");
  return await response.json();
}
const cookieOf = (response) => {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "响应应设置会话 Cookie");
  return value.split(";")[0];
};

const setup = await call("/api/v1/setup", {
  method: "POST",
  body: {
    instance_name: "CodeQuest",
    admin: { username: " Admin.Smoke ", password: "admin-password-123", display_name: "烟测管理员" },
  },
});
assert.equal(setup.status, 201, "本地数据库必须为空");
const setupBody = await json(setup);
assert.equal(setupBody.instance_name, "CodeQuest");
assert.equal(setupBody.user.username, "admin.smoke");
assert.equal(setupBody.user.email, null);
const admin = cookieOf(setup);
assert.equal((await json(await call("/api/v1/instance"))).instance_name, "CodeQuest");
assert.deepEqual(await json(await call("/api/v1/auth/status")), {
  needs_bootstrap: false, setup_url: "/setup", auth_mode: "session", registration_enabled: false,
});
assert.equal((await json(await call("/api/v1/setup/status"))).admin_url, "/admin/");
assert.equal((await call("/api/v1/me", { cookie: admin })).status, 200);
assert.equal((await call("/api/v1/admin/check", { cookie: admin })).status, 204);

const roster = Array.from({ length: 20 }, (_, index) => {
  const email = index === 1 ? "" : `student${index}@example.test`;
  const displayName = index === 1 ? "" : `Student ${index}`;
  return `student${index},${email},${displayName},`;
}).join("\n");
const preview = await call("/api/v1/admin/accounts/batch/preview", { method: "POST", body: { csv: roster }, cookie: admin });
assert.equal(preview.status, 200);
const previewBody = await json(preview);
assert.equal(previewBody.count, 20);
assert.equal(previewBody.rows[0].username, "student0");
assert.equal(previewBody.rows[1].email, null);
assert.equal(previewBody.rows[1].display_name, "student1");

const created = await call("/api/v1/admin/accounts/batch", { method: "POST", body: { csv: roster, filename: "smoke.csv" }, cookie: admin });
assert.equal(created.status, 201);
const issued = await json(created);
assert.equal(issued.batch.count, 20);
assert.equal("csv" in issued, false);
assert.match(issued.download_url, /^\/api\/v1\/admin\/accounts\/download\/[A-Za-z0-9_-]{43}$/);

const firstDownload = await call(issued.download_url);
assert.equal(firstDownload.status, 200);
assert.equal(firstDownload.headers.get("cache-control"), "no-store");
assert.equal(firstDownload.headers.get("referrer-policy"), "no-referrer");
const csv = await firstDownload.text();
const lines = csv.trim().split(/\r?\n/);
assert.equal(lines.length, 21);
assert.equal(lines[0], "username,email,display_name,password");
const firstCells = lines[1].split(",");
const secondCells = lines[2].split(",");
assert.equal(firstCells[0], "student0");
assert.equal(firstCells[1], "student0@example.test");
assert.equal(secondCells[0], "student1");
assert.equal(secondCells[1], "");
const firstPassword = firstCells[3];
const secondPassword = secondCells[3];
assert.match(firstPassword, /^Cq![A-Za-z0-9_-]{16}$/);
assert.equal((await call(issued.download_url)).status, 404);

const login = await call("/api/v1/auth/login", { method: "POST", body: { identifier: " STUDENT0 ", password: firstPassword } });
assert.equal(login.status, 200);
const loginBody = await json(login);
assert.equal(loginBody.must_change_password, true);
assert.equal(loginBody.user.username, "student0");
assert.equal(loginBody.user.email, "student0@example.test");
const student = cookieOf(login);
const studentMe = await json(await call("/api/v1/me", { cookie: student }));
assert.equal(studentMe.user.must_change_password, true);
assert.equal(studentMe.user.role, "student");
assert.equal((await call("/api/v1/courses", { cookie: student })).status, 403);
assert.equal((await call("/api/v1/admin/overview", { cookie: student })).status, 403);
const noEmailLogin = await call("/api/v1/auth/login", { method: "POST", body: { identifier: "student1", password: secondPassword } });
assert.equal(noEmailLogin.status, 200);
assert.equal((await json(noEmailLogin)).user.email, null);
const changed = await call("/api/v1/auth/password", {
  method: "POST", body: { current_password: firstPassword, new_password: "student-ready-password-123" }, cookie: student,
});
assert.equal(changed.status, 200);
const relogin = await call("/api/v1/auth/login", { method: "POST", body: { identifier: "STUDENT0@EXAMPLE.TEST", password: "student-ready-password-123" } });
assert.equal(relogin.status, 200);
const readyStudent = cookieOf(relogin);

const accountsResponse = await call("/api/v1/admin/accounts?limit=100", { cookie: admin });
assert.equal(accountsResponse.status, 200);
const accounts = (await json(accountsResponse)).accounts;
assert.equal(accounts.length, 20);
const first = accounts.find((account) => account.username === "student0");
assert.ok(first?.batch_id);
assert.equal(first?.role, "student");
assert.equal(first?.email, "student0@example.test");
assert.equal(accounts.find((account) => account.username === "student1")?.email, null);
const usernameSearch = await json(await call("/api/v1/admin/accounts?query=STUDENT0", { cookie: admin }));
assert.equal(usernameSearch.total, 1);
const emailSearch = await json(await call("/api/v1/admin/accounts?query=STUDENT0@EXAMPLE", { cookie: admin }));
assert.equal(emailSearch.total, 1);

const usernameConflict = await call(`/api/v1/admin/accounts/${first.id}`, {
  method: "PATCH", body: { username: "student2" }, cookie: admin,
});
assert.equal(usernameConflict.status, 409);
assert.equal((await json(usernameConflict)).error.code, "USERNAME_TAKEN");
const emailConflict = await call(`/api/v1/admin/accounts/${first.id}`, {
  method: "PATCH", body: { email: "student2@example.test" }, cookie: admin,
});
assert.equal(emailConflict.status, 409);
assert.equal((await json(emailConflict)).error.code, "EMAIL_TAKEN");
const edited = await call(`/api/v1/admin/accounts/${first.id}`, {
  method: "PATCH", body: { username: " Student.Zero ", email: " STUDENT.ZERO@EXAMPLE.TEST " }, cookie: admin,
});
assert.equal(edited.status, 200);
const editedAccount = (await json(edited)).account;
assert.equal(editedAccount.username, "student.zero");
assert.equal(editedAccount.email, "student.zero@example.test");
first.username = editedAccount.username;
first.email = editedAccount.email;

const batchUsernameConflict = await call("/api/v1/admin/accounts/batch", {
  method: "POST", body: { csv: "new,new@example.test,New,\nADMIN.SMOKE,other@example.test,Conflict," }, cookie: admin,
});
assert.equal(batchUsernameConflict.status, 409);
assert.equal((await json(batchUsernameConflict)).error.code, "USERNAME_TAKEN");
const batchEmailConflict = await call("/api/v1/admin/accounts/batch", {
  method: "POST", body: { csv: `new,new@example.test,New,\nother,${first.email},Conflict,` }, cookie: admin,
});
assert.equal(batchEmailConflict.status, 409);
assert.equal((await json(batchEmailConflict)).error.code, "EMAIL_TAKEN");
assert.equal((await json(await call("/api/v1/admin/accounts?limit=100", { cookie: admin }))).accounts.length, 20);

assert.equal((await call(`/api/v1/admin/accounts/${first.id}`, { method: "PATCH", body: { status: "disabled" }, cookie: admin })).status, 200);
assert.equal((await call("/api/v1/auth/me", { cookie: readyStudent })).status, 401);
const reset = await call(`/api/v1/admin/accounts/${first.id}/password-reset`, { method: "POST", cookie: admin });
assert.equal(reset.status, 200);
const temporary = (await json(reset)).temporary_password;
assert.match(temporary, /^Cq!/);
const tempLogin = await call("/api/v1/auth/login", { method: "POST", body: { identifier: first.username, password: temporary } });
assert.equal(tempLogin.status, 403, "停用账号即使重置密码也不能登录");
assert.equal((await call(`/api/v1/admin/accounts/${first.id}`, { method: "PATCH", body: { status: "active" }, cookie: admin })).status, 200);
const tempLoginEnabled = await call("/api/v1/auth/login", { method: "POST", body: { identifier: first.username, password: temporary } });
assert.equal(tempLoginEnabled.status, 200);
assert.equal((await json(tempLoginEnabled)).must_change_password, true);

const pack = {
  "course.json": JSON.stringify({ id: "smoke", slug: "smoke", title: "真实 D1 烟测课程", langs: ["javascript"], entry: "start.txt" }),
  "start.txt": "say:导师:真实 Worker 验收;end;",
};
const uploaded = await call("/api/v1/admin/courses", { method: "POST", body: { pack }, cookie: admin });
assert.equal(uploaded.status, 201);
const course = (await json(uploaded)).course;
assert.equal(course.enabled, true);
const servedPack = await call(`/api/v1/courses/${course.id}/pack`, { cookie: admin });
assert.equal(servedPack.status, 404, "学习端课程接口当前固定无课，即使管理端已上传");
const adminCourses = await json(await call("/api/v1/admin/courses", { cookie: admin }));
assert.ok(adminCourses.courses.some((item) => item.id === course.id), "管理端仍应能读取已上传课程");
assert.equal((await call(`/api/v1/admin/courses/${course.id}`, { method: "PATCH", body: { enabled: false }, cookie: admin })).status, 200);

const audit = await call("/api/v1/admin/audit?limit=100", { cookie: admin });
assert.equal(audit.status, 200);
const auditEvents = (await json(audit)).events;
const actions = auditEvents.map((event) => event.action);
const batchCreated = auditEvents.find((event) => event.action === "batch_created");
assert.equal(batchCreated?.metadata.role, "student");
assert.equal(batchCreated?.actor_username, "admin.smoke");
assert.equal(batchCreated?.actor_email, null);
for (const action of ["batch_created", "account_updated", "account_password_reset", "course_created", "course_updated"]) {
  assert.ok(actions.includes(action), `缺少审计动作 ${action}`);
}
console.log("ADMIN_API_SMOKE_PASS 用户名/邮箱登录、空邮箱、CSV、冲突回滚、账号编辑、课程上传（学习端固定无课）与审计均通过真实 Wrangler D1");
