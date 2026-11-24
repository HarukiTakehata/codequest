import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { canOpenView, CONTAINER_SHELL_ENABLED } from "../../apps/web/src/features";
import { CourseList } from "../../apps/web/src/components/Screens";
import { I18nProvider } from "../../apps/web/src/i18n/I18nProvider";
import type { User } from "../../apps/web/src/api";

const user: User = {
  id: "usr_test", username: "student", email: null, display_name: "Student", role: "student", must_change_password: false,
};

function renderCourseList() {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: "en" },
    createElement(CourseList, { user, onOpen: () => undefined, onFree: () => undefined, onContainer: () => undefined }),
  ));
}

describe("Container Shell 已启用", () => {
  it("入口与视图门禁使用同一功能开关", () => {
    expect(CONTAINER_SHELL_ENABLED).toBe(true);
    expect(canOpenView("container")).toBe(true);
    expect(canOpenView("container", false)).toBe(false);
    expect(canOpenView("free", false)).toBe(true);

    const markup = renderCourseList();
    expect(markup).toContain("Container Shell");
    expect(markup).toContain('class="mode-card mode-card-terminal"');
  });
});
