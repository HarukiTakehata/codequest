import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../../apps/web/src/components/AppShell";
import type { User } from "../../apps/web/src/api";
import { I18nProvider } from "../../apps/web/src/i18n/I18nProvider";
import { ThemeProvider } from "../../apps/web/src/theme/ThemeProvider";

function userWithRole(role: User["role"]): User {
  return {
    id: `u-${role}`,
    username: role,
    email: role === "student" ? null : `${role}@example.test`,
    display_name: role,
    role,
    must_change_password: false,
  };
}

function renderShell(role: User["role"], adminUrl = "/admin/", locale: "en" | "zh" = "en") {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: locale },
    createElement(
      ThemeProvider,
      null,
      createElement(AppShell, { user: userWithRole(role), adminUrl }, "content"),
    ),
  ));
}

describe("学习端管理面板入口", () => {
  it.each(["teacher", "admin"] as const)("%s 账号显示管理工作台入口", (role) => {
    const markup = renderShell(role);
    expect(markup).toContain('class="admin-workspace-link"');
    expect(markup).toContain('href="/admin/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain("Admin workspace");
    expect(markup).toContain("lucide-shield-check");
  });

  it("student 账号不显示管理工作台入口", () => {
    const markup = renderShell("student");
    expect(markup).not.toContain("admin-workspace-link");
    expect(markup).not.toContain("Admin workspace");
    expect(markup).not.toContain('href="/admin/"');
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/admin/",
    "/\\evil.example/admin/",
    "/\t/evil.example/admin/",
    "not a url",
  ])("危险或无效的管理地址 %s 不渲染入口", (adminUrl) => {
    const markup = renderShell("admin", adminUrl);
    expect(markup).not.toContain("admin-workspace-link");
    expect(markup).not.toContain("Admin workspace");
  });

  it.each([
    "https://admin.example.test/",
    "http://localhost:5174/",
  ])("允许安全的 HTTP(S) 管理地址 %s", (adminUrl) => {
    const markup = renderShell("teacher", adminUrl);
    expect(markup).toContain(`href="${adminUrl}"`);
    expect(markup).toContain('rel="noreferrer"');
  });

  it("登录后可打开用户信息面板", () => {
    const markup = renderToStaticMarkup(createElement(
      I18nProvider,
      { initialLocale: "en" },
      createElement(ThemeProvider, null, createElement(AppShell, {
        user: userWithRole("student"),
        onProfile: () => undefined,
      }, "content")),
    ));
    expect(markup).toContain('class="account-chip account-chip-button"');
    expect(markup).toContain('aria-label="Account"');
  });

  it("账户标签与工作台文案支持中英文", () => {
    const studentWithoutEmail = renderToStaticMarkup(createElement(
      I18nProvider,
      { initialLocale: "en" },
      createElement(ThemeProvider, null, createElement(AppShell, {
        user: { id: "u-student", username: "learner", email: null, display_name: null, role: "student", must_change_password: false },
      }, "content")),
    ));
    expect(studentWithoutEmail).toContain('<span class="account-name">learner</span>');
    expect(studentWithoutEmail).toContain('<span class="account-avatar">L</span>');
    expect(studentWithoutEmail).not.toContain("null");

    const studentWithCorruptedName = renderToStaticMarkup(createElement(
      I18nProvider,
      { initialLocale: "en" },
      createElement(ThemeProvider, null, createElement(AppShell, {
        user: { id: "u-student", username: "learner", email: null, display_name: "?????", role: "student", must_change_password: false },
      }, "content")),
    ));
    expect(studentWithCorruptedName).toContain('<span class="account-name">learner</span>');
    expect(studentWithCorruptedName).not.toContain("?????");

    expect(renderShell("student", "/admin/", "zh")).toContain('<span class="account-role">学生</span>');
    expect(renderShell("teacher", "/admin/", "zh")).toContain('<span class="account-role">教师</span>');
    expect(renderShell("admin", "/admin/", "zh")).toContain('<span class="account-role">管理员</span>');
    expect(renderShell("admin", "/admin/", "zh")).toContain("管理工作台");

    expect(renderShell("student", "/admin/", "en")).toContain('<span class="account-role">Student</span>');
    expect(renderShell("teacher", "/admin/", "en")).toContain('<span class="account-role">Teacher</span>');
    expect(renderShell("admin", "/admin/", "en")).toContain('<span class="account-role">Administrator</span>');
  });
});
