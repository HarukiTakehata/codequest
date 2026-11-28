import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../apps/web/src/i18n/I18nProvider";
import { ThemeProvider } from "../../apps/web/src/theme/ThemeProvider";
import { AppShell } from "../../apps/web/src/components/AppShell";
import { ContainerStartupProgress } from "../../apps/web/src/components/ContainerStartupProgress";
import { GoalPanel } from "../../apps/web/src/components/GoalPanel";
import { ChangePasswordPage, CourseList, LoginPage, SetupWizard } from "../../apps/web/src/components/Screens";
import type { User } from "../../apps/web/src/api";

function render(locale: "en" | "zh", node: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(ThemeProvider, null, node)));
}

describe("公共界面组件", () => {
  it("顶栏品牌、语言与主题按钮可本地化", () => {
    const english = render("en", createElement(AppShell, { appName: "CodeQuest" }, "content"));
    expect(english).toContain("Switch language");
    expect(english).toContain("Switch to dark mode");
    expect(english).toContain("Learn by playing. Build with code.");
    const chinese = render("zh", createElement(AppShell, { appName: "学习实例" }, "content"));
    expect(chinese).toContain("学习实例");
    expect(chinese).toContain("切换语言");
    expect(chinese).toContain("切换到深色模式");
    expect(render("zh", createElement(AppShell, { appName: "学习实例", homeHref: "/courses" }, "content"))).toContain('<a class="brand" href="/courses"');
  });

  it("容器进度标题、数值和 ARIA 文本随语言切换", () => {
    const progress = { phase: "downloading" as const, loaded: 25, total: 100 };
    const english = render("en", createElement(ContainerStartupProgress, { progress }));
    expect(english).toContain("Loading the WASM runtime");
    expect(english).toContain("25%");
    expect(english).toContain('aria-valuenow="25"');
    const chinese = render("zh", createElement(ContainerStartupProgress, { progress }));
    expect(chinese).toContain("正在传输 WASM 运行时");
    expect(chinese).toContain('aria-valuenow="25"');
    const starting = render("zh", createElement(ContainerStartupProgress, { progress: { phase: "starting" } }));
    expect(starting).toContain('aria-valuetext="启动中"');
  });

  it("登录、初始化、修改密码和课程库均使用当前语言", () => {
    const englishLogin = render("en", createElement(LoginPage, { onDone: () => undefined }));
    expect(englishLogin).toContain("Welcome back");
    expect(englishLogin).toContain("Username or email");
    expect(englishLogin).toContain('id="login-identifier"');
    expect(englishLogin).toContain('type="text"');
    expect(englishLogin).toContain('autoComplete="username"');
    expect(englishLogin).toContain("Accounts are issued by your administrator");
    const chineseLogin = render("zh", createElement(LoginPage, { onDone: () => undefined }));
    expect(chineseLogin).toContain("欢迎回来");
    expect(chineseLogin).toContain("用户名或邮箱");
    expect(chineseLogin).toContain("账号由管理员批量发放");

    const setup = render("en", createElement(SetupWizard, { onDone: () => undefined }));
    for (const label of ["Instance", "Administrator", "Review"]) expect(setup).toContain(label);
    expect(setup).not.toContain("Course pack");

    const user: User = { id: "u1", username: "ada", email: null, display_name: "Ada", role: "student", must_change_password: false };
    const password = render("zh", createElement(ChangePasswordPage, { user, onDone: () => undefined }));
    expect(password).toContain("修改初始密码");
    expect(password).toContain("修改密码并继续");
    expect(password).toContain("保存后会自动登录");

    const notice = render("en", createElement(LoginPage, { onDone: () => undefined, notice: "password.changedNotice" }));
    expect(notice).toContain("Password updated. Sign in with your new password.");

    const courses = render("en", createElement(CourseList, { user, onOpen: () => undefined, onFree: () => undefined, onContainer: () => undefined }));
    expect(courses).toContain("Welcome back, Ada");
    expect(courses).toContain("Free mode");
    expect(courses).toContain("Course content is not available in this version yet");
    expect(courses).toContain('href="/free"');
    expect(courses).toContain('href="/container"');
  });

  it("目标面板本地化空状态与提交提示", () => {
    const english = render("en", createElement(GoalPanel, { goals: [], allDone: true, required: true }));
    expect(english).toContain("No process goals for this challenge.");
    expect(english).toContain("Ready to submit");
    const chinese = render("zh", createElement(GoalPanel, { goals: [], allDone: false, required: true }));
    expect(chinese).toContain("本题暂无过程目标");
    expect(chinese).toContain("需全部达成后才能提交");
  });
});
