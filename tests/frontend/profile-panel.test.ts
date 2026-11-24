import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfilePanel } from "../../apps/web/src/components/ProfilePanel";
import type { User } from "../../apps/web/src/api";
import { I18nProvider } from "../../apps/web/src/i18n/I18nProvider";

const user: User = {
  id: "usr_profile",
  username: "learner",
  email: null,
  display_name: null,
  role: "student",
  must_change_password: false,
  created_at: "2026-11-01T08:00:00.000Z",
  last_seen_at: "2026-11-27T12:00:00.000Z",
};

function render(profile: User, locale: "en" | "zh" = "en") {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: locale },
    createElement(ProfilePanel, { user: profile, onClose: () => undefined, onUpdated: () => undefined }),
  ));
}

describe("学习端用户信息面板", () => {
  it("展示用户名、邮箱、角色与时间，并允许编辑显示名", () => {
    const html = render(user);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("User information");
    expect(html).toContain("learner");
    expect(html).toContain("Not set");
    expect(html).toContain("Student");
    expect(html).toContain('id="profile-display-name"');
    expect(html).toContain("Save changes");
    expect(html).not.toContain("?????");
    expect(html).not.toContain("null");
  });

  it("中文界面与乱码显示名回退用户名", () => {
    const html = render({ ...user, display_name: "?????" }, "zh");
    expect(html).toContain("用户信息");
    expect(html).toContain("用户名");
    expect(html).toContain("未设置");
    expect(html).toContain("学生");
    expect(html).toContain("保存更改");
    expect(html).not.toContain("?????");
    expect(html).not.toContain("null");
  });
});
