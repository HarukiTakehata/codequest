import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { api, type AdminUser } from "../../apps/admin/src/api";
import { ChangePasswordPage, ForbiddenPage, LoginPage } from "../../apps/admin/src/components/Auth";
import { AdminShell } from "../../apps/admin/src/components/AdminShell";
import { BatchWizard } from "../../apps/admin/src/components/BatchWizard";
import { ToastProvider } from "../../apps/admin/src/components/Toast";
import { AccountsPage } from "../../apps/admin/src/pages/AccountsPage";
import { initials, safeExternalUrl } from "../../apps/admin/src/lib/format";
import { routeFromPath } from "../../apps/admin/src/lib/router";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const adminUser: AdminUser = {
  id: "usr_admin", username: "admin", email: "admin@example.test", display_name: "管理员", role: "admin", must_change_password: false,
};
const teacherUser: AdminUser = {
  id: "usr_teacher", username: "teacher", email: "teacher@example.test", display_name: "教研教师", role: "teacher", must_change_password: false,
};
const studentUser: AdminUser = {
  id: "usr_student", username: "student", email: null, display_name: null, role: "student", must_change_password: false,
};

describe("M6.1 管理面板前端", () => {
  it("登录页服务端渲染包含管理员入口与安全说明", () => {
    const html = renderToStaticMarkup(createElement(LoginPage, { onAuthenticated: () => undefined }));
    expect(html).toContain("欢迎回来");
    expect(html).toContain("登录管理面板");
    expect(html).toContain("HttpOnly Cookie");
    expect(html).toContain("用户名或邮箱");
    expect(html).toContain('id="login-identifier"');
    expect(html).toContain('type="text"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
  });

  it("临时密码会话可渲染改密页并显示当前账号", () => {
    const html = renderToStaticMarkup(createElement(ChangePasswordPage, {
      user: {
        id: "usr_temporary", username: "temporary", email: null, display_name: null,
        role: "admin", must_change_password: true,
      },
      onDone: () => undefined,
    }));
    expect(html).toContain("请先更新密码");
    expect(html).toContain("temporary");
    expect(html).not.toContain("null");
    expect(html).toContain('id="current-password"');
    expect(html).toContain('id="new-password"');
  });

  it("管理面板工作区显示真实实例名，配置加载时显示加载状态", () => {
    const props = {
      user: {
        id: "usr_admin", username: "admin", email: "admin@example.test", display_name: "管理员",
        role: "admin" as const, must_change_password: false,
      },
      route: "overview" as const,
      navigate: () => undefined,
      onLogout: () => undefined,
      loggingOut: false,
      configError: null,
      onReloadConfig: () => undefined,
      children: null,
    };
    const configured = renderToStaticMarkup(createElement(AdminShell, {
      ...props,
      config: {
        instance_name: "共享教研空间", editor_url: null, learner_url: null, download_link_ttl_hours: 24,
      },
      configLoading: false,
    }));
    expect(configured).toContain("共享教研空间");
    expect(configured).not.toContain("学习系统");
    expect(configured).not.toContain(">在线<");

    const loading = renderToStaticMarkup(createElement(AdminShell, {
      ...props, config: null, configLoading: true,
    }));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("正在加载实例…");
  });

  it("无邮箱账号使用用户名显示名称与头像首字母", () => {
    expect(initials(null, "learner", null)).toBe("L");
    expect(initials("Alice", "learner", null)).toBe("A");
    expect(initials("?????", "learner", null)).toBe("L");
    expect(initials(null, null, null)).toBe("?");

    const props = {
      user: { ...adminUser, username: "owner", email: null, display_name: null },
      route: "overview" as const,
      navigate: () => undefined,
      onProfile: () => undefined,
      onLogout: () => undefined,
      loggingOut: false,
      config: { instance_name: "共享教研空间", editor_url: null, learner_url: null, download_link_ttl_hours: 24 },
      configLoading: false,
      configError: null,
      onReloadConfig: () => undefined,
      children: null,
    };
    const html = renderToStaticMarkup(createElement(AdminShell, props));
    expect(html).toContain("owner");
    expect(html).toContain("未设置邮箱");
    expect(html).toContain('class="sidebar-profile"');
    expect(html).toContain('class="topbar-profile"');
    expect(html).not.toContain("null");

    const corrupted = renderToStaticMarkup(createElement(AdminShell, {
      ...props,
      user: { ...props.user, display_name: "?????" },
    }));
    expect(corrupted).toContain("owner");
    expect(corrupted).not.toContain("?????");
  });

  it("教师工作台隐藏审计并显示当前角色，管理员保留审计入口", () => {
    const props = {
      route: "overview" as const,
      navigate: () => undefined,
      onLogout: () => undefined,
      loggingOut: false,
      config: { instance_name: "共享教研空间", editor_url: null, learner_url: null, download_link_ttl_hours: 24 },
      configLoading: false,
      configError: null,
      onReloadConfig: () => undefined,
      children: null,
    };
    const teacher = renderToStaticMarkup(createElement(AdminShell, { ...props, user: teacherUser }));
    expect(teacher).toContain("教师");
    expect(teacher).not.toContain('href="/audit"');
    expect(teacher).not.toContain("审计记录");

    const admin = renderToStaticMarkup(createElement(AdminShell, { ...props, user: adminUser }));
    expect(admin).toContain("管理员");
    expect(admin).toContain('href="/audit"');
    expect(admin).toContain("审计记录");
  });

  it("禁止页区分学生与教师权限说明", () => {
    const props = { onLogout: () => undefined, loggingOut: false };
    const student = renderToStaticMarkup(createElement(ForbiddenPage, { ...props, user: studentUser }));
    expect(student).toContain("学生账号不能访问管理面板");
    expect(student).toContain("学生账号仅用于学习端");
    expect(student).toContain("student");
    expect(student).not.toContain("null");
    expect(student).not.toContain("教师可以管理概览");

    const teacher = renderToStaticMarkup(createElement(ForbiddenPage, { ...props, user: teacherUser }));
    expect(teacher).toContain("教师账号不能访问此页面");
    expect(teacher).toContain("审计记录及教师账号管理仅限管理员");
  });

  it("教师账号列表固定筛选学生且无角色编辑入口", () => {
    const teacher = renderToStaticMarkup(createElement(ToastProvider, null,
      createElement(AccountsPage, { role: "teacher" }),
    ));
    const roleFilter = teacher.match(/<select[^>]*id="account-role-filter"[^>]*>/)?.[0] ?? "";
    expect(roleFilter).toContain("disabled");
    expect(teacher).toContain("仅展示学生账号");
    expect(teacher).not.toContain('value="teacher"');
    expect(teacher).not.toContain('id="account-role"');

    const admin = renderToStaticMarkup(createElement(ToastProvider, null,
      createElement(AccountsPage, { role: "admin" }),
    ));
    const adminRoleFilter = admin.match(/<select[^>]*id="account-role-filter"[^>]*>/)?.[0] ?? "";
    expect(adminRoleFilter).not.toContain("disabled");
    expect(admin).toContain('value="teacher"');
    expect(admin).toContain("搜索用户名、邮箱或显示名称");
    expect(admin).toContain("展示学生与教师账号");
  });

  it("发号向导允许管理员选择教师角色并固定教师只创建学生", () => {
    const teacher = renderToStaticMarkup(createElement(ToastProvider, null,
      createElement(BatchWizard, { ttlHours: 24, role: "teacher", onCreated: () => undefined }),
    ));
    const teacherRole = teacher.match(/<select[^>]*id="batch-role"[^>]*>/)?.[0] ?? "";
    expect(teacherRole).toContain("disabled");
    expect(teacher).not.toContain('value="teacher"');
    expect(teacher).toContain("教师只能创建学生账号");

    const admin = renderToStaticMarkup(createElement(ToastProvider, null,
      createElement(BatchWizard, { ttlHours: 24, role: "admin", onCreated: () => undefined }),
    ));
    const adminRole = admin.match(/<select[^>]*id="batch-role"[^>]*>/)?.[0] ?? "";
    expect(adminRole).not.toContain("disabled");
    expect(admin).toContain('value="teacher"');
    expect(admin).toContain("username,email,display_name,password");
    expect(admin).toContain("username,email,display_name[,password]");
    expect(admin).toContain("用户名必填，邮箱可空");
  });

  it("批量预览与创建请求携带明确角色并原样传递 CSV", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const csv = "username,email,display_name,password\nteacher,teacher@example.test,Teacher,\n";
    vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
      requests.push({ path, body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      await api.previewBatch(csv, "teachers.csv", "teacher");
      await api.createBatch(csv, "teachers.csv", "teacher");
      expect(requests.map((request) => request.path)).toEqual([
        "/api/v1/admin/accounts/batch/preview",
        "/api/v1/admin/accounts/batch",
      ]);
      expect(requests.every((request) => request.body.role === "teacher")).toBe(true);
      expect(requests.every((request) => request.body.filename === "teachers.csv")).toBe(true);
      expect(requests.every((request) => request.body.csv === csv)).toBe(true);
      expect(requests.every((request) => !("rows" in request.body))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("登录发送 identifier，账号更新支持用户名与可空邮箱", async () => {
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
      requests.push({ path, method: options.method ?? "GET", body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ user: adminUser, account: adminUser }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      await api.login("admin", "secret-password");
      await api.updateAccount("usr_teacher", { username: "teacher_updated", email: null, display_name: "教研教师" });
      expect(requests[0]).toEqual({
        path: "/api/v1/auth/login", method: "POST", body: { identifier: "admin", password: "secret-password" },
      });
      expect(requests[1]).toEqual({
        path: "/api/v1/admin/accounts/usr_teacher", method: "PATCH",
        body: { username: "teacher_updated", email: null, display_name: "教研教师" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("History API 路由支持刷新深链接与 404 识别", () => {
    expect(routeFromPath("/overview")).toBe("overview");
    expect(routeFromPath("/batches")).toBe("batches");
    expect(routeFromPath("/accounts")).toBe("accounts");
    expect(routeFromPath("/courses")).toBe("courses");
    expect(routeFromPath("/courses/")).toBe("courses");
    expect(routeFromPath("/audit")).toBe("audit");
    expect(routeFromPath("/missing")).toBe("notfound");
    expect(routeFromPath("/admin")).toBe("overview");
    expect(routeFromPath("/admin/")).toBe("overview");
    expect(routeFromPath("/admin/overview")).toBe("overview");
    expect(routeFromPath("/admin/accounts")).toBe("accounts");
    expect(routeFromPath("/admin/audit")).toBe("audit");
  });

  it("外部编辑器链接只允许 HTTP(S)，拒绝脚本协议", () => {
    expect(safeExternalUrl("https://editor.example.test")).toBe("https://editor.example.test/");
    expect(safeExternalUrl("http://localhost:3001")).toBe("http://localhost:3001/");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
  });

  it("管理端不写浏览器存储、不注入原始 HTML，并发布安全响应头", () => {
    const files = ["App.tsx", "api.ts", "components/BatchWizard.tsx", "components/Auth.tsx", "pages/AccountsPage.tsx"];
    for (const file of files) {
      const source = fs.readFileSync(new URL(`../../apps/admin/src/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/(?:localStorage|sessionStorage)\.setItem/);
      expect(source).not.toContain("dangerouslySetInnerHTML");
      expect(source).not.toMatch(/console\.(?:log|info|debug)/);
    }
    const headers = fs.readFileSync(new URL("../../apps/admin/public/_headers", import.meta.url), "utf8");
    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("Cache-Control: no-store");
  });
});
