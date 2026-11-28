import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getTranslator, I18nProvider } from "@codequest/i18n";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError, errorMessage, setUnauthorizedHandler, type AdminAccount, type AdminUser } from "../../apps/admin/src/api";
import { ChangePasswordPage, ForbiddenPage, LoginPage } from "../../apps/admin/src/components/Auth";
import { AdminShell } from "../../apps/admin/src/components/AdminShell";
import { BatchWizard } from "../../apps/admin/src/components/BatchWizard";
import { ToastProvider } from "../../apps/admin/src/components/Toast";
import { AccountsPage } from "../../apps/admin/src/pages/AccountsPage";
import { AuditPage } from "../../apps/admin/src/pages/AuditPage";
import { BatchesPage } from "../../apps/admin/src/pages/BatchesPage";
import { CoursesPage } from "../../apps/admin/src/pages/CoursesPage";
import { OverviewPage } from "../../apps/admin/src/pages/OverviewPage";
import { useAsyncData } from "../../apps/admin/src/hooks/useAsyncData";
import { auditActionLabel, auditTargetLabel, batchStatusLabel, formatDate, formatNumber, initials, safeExternalUrl } from "../../apps/admin/src/lib/format";
import { routeFromPath } from "../../apps/admin/src/lib/router";
import { validatePasswordChange } from "../../apps/admin/src/lib/password";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const renderWithI18n = (element: ReactElement, locale: "zh" | "en" = "zh") => renderToStaticMarkup(
  createElement(I18nProvider, { initialLocale: locale }, element),
);

vi.mock("../../apps/admin/src/hooks/useAsyncData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/admin/src/hooks/useAsyncData")>();
  return { ...actual, useAsyncData: vi.fn(actual.useAsyncData) };
});

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
    const html = renderWithI18n(createElement(LoginPage, { onAuthenticated: () => undefined }));
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
    const html = renderWithI18n(createElement(ChangePasswordPage, {
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

  it("个人资料弹窗提供管理员自助改密表单", () => {
    const source = fs.readFileSync(new URL("../../apps/admin/src/components/ProfileDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('id="profile-current-password"');
    expect(source).toContain('id="profile-new-password"');
    expect(source).toContain('id="profile-confirm-password"');
    expect(source).toContain('autoComplete="current-password"');
    expect(source).toContain('autoComplete="new-password"');
    expect(source).toContain("await api.changePassword(currentPassword, newPassword)");
    expect(source).toContain("onPasswordChanged()");
    expect(getTranslator("zh")("admin.profile.password.title")).toBe("修改密码");
    expect(getTranslator("en")("admin.profile.password.title")).toBe("Change your password");
    expect(getTranslator("en")("admin.profile.password.confirm")).toBe("Confirm new password");
  });

  it("自助改密校验必填、长度、确认一致和不能与旧密相同", () => {
    expect(validatePasswordChange("", "new-password-123", "new-password-123")).toBe("admin.errors.currentPasswordRequired");
    expect(validatePasswordChange("old-password-123", "", "")).toBe("admin.errors.newPasswordRequired");
    expect(validatePasswordChange("old-password-123", "short", "short")).toBe("admin.errors.passwordTooShort");
    expect(validatePasswordChange("old-password-123", "new-password-123", "different-password")).toBe("admin.errors.passwordMismatch");
    expect(validatePasswordChange("same-password-123", "same-password-123", "same-password-123")).toBe("admin.errors.passwordSameAsCurrent");
    expect(validatePasswordChange("old-password-123", "new-password-123", "new-password-123")).toBeNull();
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
    const configured = renderWithI18n(createElement(AdminShell, {
      ...props,
      config: {
        instance_name: "共享教研空间", editor_url: null, learner_url: null, download_link_ttl_hours: 24,
      },
      configLoading: false,
    }));
    expect(configured).toContain("共享教研空间");
    expect(configured).not.toContain("学习系统");
    expect(configured).not.toContain(">在线<");
    expect(configured).toContain('data-testid="language-switcher"');
    expect(configured).toContain('aria-label="切换语言"');
    expect(configured).toContain("lucide-globe-2");
    expect(configured).not.toContain("language-current");
    expect(configured).not.toContain("lucide-chevron-down");

    const loading = renderWithI18n(createElement(AdminShell, {
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
    const html = renderWithI18n(createElement(AdminShell, props));
    expect(html).toContain("owner");
    expect(html).toContain("未设置");
    expect(html).toContain('class="sidebar-profile"');
    expect(html).toContain('class="topbar-profile"');
    expect(html).not.toContain("null");

    const corrupted = renderWithI18n(createElement(AdminShell, {
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
    const teacher = renderWithI18n(createElement(AdminShell, { ...props, user: teacherUser }));
    expect(teacher).toContain("教师");
    expect(teacher).not.toContain('href="/audit"');
    expect(teacher).not.toContain("审计记录");

    const admin = renderWithI18n(createElement(AdminShell, { ...props, user: adminUser }));
    expect(admin).toContain("管理员");
    expect(admin).toContain('href="/audit"');
    expect(admin).toContain("审计记录");
  });

  it("禁止页区分学生与教师权限说明", () => {
    const props = { onLogout: () => undefined, loggingOut: false };
    const student = renderWithI18n(createElement(ForbiddenPage, { ...props, user: studentUser }));
    expect(student).toContain("学生账号不能访问管理面板");
    expect(student).toContain("学生账号仅用于学习端");
    expect(student).toContain("student");
    expect(student).not.toContain("null");
    expect(student).not.toContain("教师可以管理概览");

    const teacher = renderWithI18n(createElement(ForbiddenPage, { ...props, user: teacherUser }));
    expect(teacher).toContain("教师账号不能访问此页面");
    expect(teacher).toContain("审计记录及教师账号管理仅限管理员");
  });

  it("教师账号列表固定筛选学生且无角色编辑入口", () => {
    const teacher = renderWithI18n(createElement(ToastProvider, null,
      createElement(AccountsPage, { role: "teacher", currentUserId: teacherUser.id }),
    ));
    const roleFilter = teacher.match(/<select[^>]*id="account-role-filter"[^>]*>/)?.[0] ?? "";
    expect(roleFilter).toContain("disabled");
    expect(teacher).toContain("仅展示学生账号");
    expect(teacher).not.toContain('value="teacher"');
    expect(teacher).not.toContain('id="account-role"');

    const admin = renderWithI18n(createElement(ToastProvider, null,
      createElement(AccountsPage, { role: "admin", currentUserId: adminUser.id }),
    ));
    const adminRoleFilter = admin.match(/<select[^>]*id="account-role-filter"[^>]*>/)?.[0] ?? "";
    expect(adminRoleFilter).not.toContain("disabled");
    expect(admin).toContain('value="teacher"');
    expect(admin).toContain('value="admin"');
    expect(admin).toContain("搜索用户名、邮箱或显示名称");
    expect(admin).toContain("展示学生、教师与管理员账号");
  });

  it("账号管理文本接入共享 i18n，可按语言渲染", () => {
    const html = renderWithI18n(createElement(ToastProvider, null,
      createElement(AccountsPage, { role: "admin", currentUserId: adminUser.id }),
    ), "en");
    expect(html).toContain("Account management");
    expect(html).toContain("All roles");
    expect(html).toContain("Search username, email, or display name");
    expect(html).not.toContain("账号管理");
  });

  it("认证页与管理壳层支持英文，语言入口只显示单个 Globe 图标", () => {
    const login = renderWithI18n(createElement(LoginPage, { onAuthenticated: () => undefined }), "en");
    expect(login).toContain("Welcome back");
    expect(login).toContain("Sign in to admin panel");
    expect(login).toContain("Secure access backed by server-side sessions");
    expect(login).not.toContain("欢迎回来");

    const shell = renderWithI18n(createElement(AdminShell, {
      user: adminUser,
      route: "overview" as const,
      navigate: () => undefined,
      onLogout: () => undefined,
      loggingOut: false,
      config: { instance_name: "Shared workspace", editor_url: null, learner_url: null, download_link_ttl_hours: 24 },
      configLoading: false,
      configError: null,
      onReloadConfig: () => undefined,
      children: null,
    }), "en");
    expect(shell).toContain('aria-label="Switch language"');
    expect(shell).toContain('data-testid="language-switcher"');
    expect(shell).toContain("lucide-globe-2");
    expect(shell.match(/lucide-globe-2/g)).toHaveLength(1);
    expect(shell).not.toContain("language-current");
    expect(shell).not.toContain("ChevronDown");
    expect(shell).not.toContain("lucide-chevron-down");
  });

  it("发号、课程、审计与概览页的主要文案均按英文渲染", () => {
    const batches = renderWithI18n(createElement(ToastProvider, null,
      createElement(BatchesPage, { ttlHours: 24, role: "admin" }),
    ), "en");
    expect(batches).toContain("Batch account issuance");
    expect(batches).toContain("Download template");
    expect(batches).toContain("Batch history");
    expect(batches).not.toContain("批量发号");

    const courses = renderWithI18n(createElement(CoursesPage), "en");
    expect(courses).toContain("Course management");
    expect(courses).toContain("Loading course list");
    expect(courses).not.toContain("课程管理");

    const audit = renderWithI18n(createElement(AuditPage), "en");
    expect(audit).toContain("Audit log");
    expect(audit).toContain("Operation log");
    expect(audit).not.toContain("审计记录");

    const overview = renderWithI18n(createElement(OverviewPage, {
      role: "admin",
      config: null,
      configLoading: false,
      configError: null,
      onReloadConfig: () => undefined,
      navigate: () => undefined,
    }), "en");
    expect(overview).toContain("Welcome back, Administrator");
    expect(overview).toContain("Refresh overview");
    expect(overview).not.toContain("欢迎回来");
  });

  it("日期、数字、审计标签与错误兜底随 locale 切换", () => {
    const english = getTranslator("en");
    const chinese = getTranslator("zh");
    const date = new Date("2026-11-27T08:00:00.000Z");
    const expectedEnglishDate = new Intl.DateTimeFormat("en", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
    const expectedChineseDate = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
    expect(formatDate(date.toISOString(), "en")).toBe(expectedEnglishDate);
    expect(formatDate(date.toISOString(), "zh")).toBe(expectedChineseDate);
    expect(formatNumber(12345, "en")).toBe("12,345");
    expect(batchStatusLabel("pending", english)).toBe("Pending download");
    expect(batchStatusLabel("pending", chinese)).toBe("待领取");
    expect(auditActionLabel("batch_created", english)).toBe("Create issuance batch");
    expect(auditActionLabel("batch_created", chinese)).toBe("创建发号批次");
    expect(auditTargetLabel("issued_batch", english)).toBe("Issuance batch");
    expect(errorMessage(new ApiError(409, "USERNAME_TAKEN", "用户名已被使用"), english)).toBe("The username is already in use.");
    expect(errorMessage(new ApiError(400, "CUSTOM_CODE", "服务端具体说明"), english)).toBe("服务端具体说明");
    expect(errorMessage(new TypeError("Failed to fetch"), english)).toBe(english("errors.network"));
    expect(errorMessage(undefined, chinese)).toBe("操作失败，请稍后重试。");
  });

  it("账号列表 SSR 展示管理员账号，但本人仍不提供重置密码入口", () => {
    const common = {
      status: "active" as const,
      must_change_password: false,
      created_at: "2026-11-27T08:00:00.000Z",
      last_seen_at: null,
      password_updated_at: null,
      batch_id: null,
      batch_filename: null,
    };
    const leakedSelf: AdminAccount = {
      ...common,
      ...adminUser,
      role: "admin",
    };
    const alice: AdminAccount = {
      ...common,
      id: "usr_alice",
      username: "alice",
      email: "alice@example.test",
      display_name: "Alice",
      role: "student",
    };
    vi.mocked(useAsyncData).mockReturnValueOnce({
      data: { accounts: [leakedSelf, alice], total: 2, limit: 20, offset: 0 },
      loading: false,
      error: null,
      reload: vi.fn(),
      updateData: vi.fn(),
    });

    const html = renderWithI18n(createElement(ToastProvider, null,
      createElement(AccountsPage, { role: "admin", currentUserId: adminUser.id }),
    ));
    expect(html).toContain("alice@example.test");
    expect(html).toContain("admin@example.test");
    expect(html).toMatch(/<small class="mono">admin<\/small>/);
    expect(html.match(/<tr data-label="账号">/g)).toHaveLength(2);
    expect(html.match(/>重置密码</g)).toHaveLength(1);
    expect(html).toContain("2 位账号");
    expect(html).toContain('aria-label="账号分页"');
    expect(html).toContain("共 <strong>2</strong> 条");
  });

  it("账号页展示管理员角色，但重置请求前仍防护当前账号并保留自主改密入口", () => {
    const accountsSource = fs.readFileSync(new URL("../../apps/admin/src/pages/AccountsPage.tsx", import.meta.url), "utf8");
    const appSource = fs.readFileSync(new URL("../../apps/admin/src/App.tsx", import.meta.url), "utf8");
    const mainSource = fs.readFileSync(new URL("../../apps/admin/src/main.tsx", import.meta.url), "utf8");
    const apiSource = fs.readFileSync(new URL("../../apps/admin/src/api.ts", import.meta.url), "utf8");
    expect(mainSource).toContain('<I18nProvider defaultLocale="zh">');
    expect(appSource).toContain("<AccountsPage role={user.role} currentUserId={user.id} />");
    expect(appSource).toContain("<ProfileDialog");
    expect(accountsSource).toContain('from "@codequest/i18n"');
    expect(accountsSource).toContain('t("role.admin")');
    expect(accountsSource).toContain('const rows = (accounts.data?.accounts ?? []).filter((account) => isAdmin || account.role === "student");');
    expect(accountsSource).toMatch(/\{account\.id !== currentUserId && \([\s\S]*?accounts\.reset/);
    const selfGuard = "if (!resetTarget || resetTarget.id === currentUserId) return;";
    expect(accountsSource).toContain(selfGuard);
    expect(accountsSource.indexOf(selfGuard)).toBeLessThan(accountsSource.indexOf("await api.resetPassword(resetTarget.id)"));
    expect(apiSource).toContain('changePassword: (currentPassword: string, newPassword: string)');
    expect(apiSource).toContain('"/api/v1/auth/password"');
  });

  it("发号向导允许管理员选择教师角色并固定教师只创建学生", () => {
    const teacher = renderWithI18n(createElement(ToastProvider, null,
      createElement(BatchWizard, { ttlHours: 24, role: "teacher", onCreated: () => undefined }),
    ));
    const teacherRole = teacher.match(/<select[^>]*id="batch-role"[^>]*>/)?.[0] ?? "";
    expect(teacherRole).toContain("disabled");
    expect(teacher).not.toContain('value="teacher"');
    expect(teacher).toContain("教师只能创建学生账号");

    const admin = renderWithI18n(createElement(ToastProvider, null,
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

  it("当前密码错误保留在改密弹窗，只有会话失效才触发全局登出", async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "CURRENT_PASSWORD_INCORRECT", message: "当前密码不正确", request_id: "test" },
      }), { status: 401, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "UNAUTHENTICATED", message: "请先登录", request_id: "test" },
      }), { status: 401, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(api.changePassword("wrong-password", "new-password-123")).rejects.toMatchObject({
        status: 401,
        code: "CURRENT_PASSWORD_INCORRECT",
      });
      expect(unauthorized).not.toHaveBeenCalled();

      await expect(api.changePassword("admin-password-123", "new-password-123")).rejects.toMatchObject({
        status: 401,
        code: "UNAUTHENTICATED",
      });
      expect(unauthorized).toHaveBeenCalledTimes(1);
    } finally {
      setUnauthorizedHandler(undefined);
      vi.unstubAllGlobals();
    }
  });

  it("管理员自主改密仍调用 /api/v1/auth/password", async () => {
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
      requests.push({ path, method: options.method ?? "GET", body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, reauth_required: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    try {
      await api.changePassword("admin-password-123", "admin-ready-password-123");
      expect(requests).toEqual([{
        path: "/api/v1/auth/password", method: "POST",
        body: { current_password: "admin-password-123", new_password: "admin-ready-password-123" },
      }]);
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
