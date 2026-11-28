import { describe, expect, it } from "vitest";
import { en, zh, getTranslator, htmlLang, isLocale, LOCALES, resolveLocale } from "@codequest/i18n";
import { errorMessageKey, localizeError } from "../../apps/web/src/i18n/errors";
import { ApiError } from "../../apps/web/src/api";
import { isFactoryFreeSample } from "../../apps/web/src/free";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string; readdirSync(path: URL, options?: { withFileTypes: boolean }): Array<{ name: string; isDirectory(): boolean; isFile(): () => boolean }> }>("node:fs");

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("界面 i18n", () => {
  it("英文字典是事实源，中英文键与插值参数完全一致", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("支持中英文切换、插值与文档语言", () => {
    const english = getTranslator("en");
    const chinese = getTranslator("zh");
    expect(english("courses.welcome", { name: "Ada" })).toBe("Welcome back, Ada");
    expect(chinese("courses.welcome", { name: "Ada" })).toBe("欢迎回来，Ada");
    expect(chinese("login.identifier")).toBe("用户名或邮箱");
    expect(english("login.identifier")).toBe("Username or email");
    expect(chinese("setup.adminUsername")).toBe("管理员用户名");
    expect(english("setup.adminEmail")).toBe("Administrator email (optional)");
    expect(chinese("accounts.title")).toBe("账号管理");
    expect(english("accounts.title")).toBe("Account management");
    expect(chinese("accounts.count", { count: 3 })).toBe("3 位账号");
    expect(chinese("judge.failed", { score: 60 })).toBe("未通过 · 60 分");
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("en")).toBe("en");
  });

  it("按已保存偏好和浏览器语言解析 locale，非法值回退英文", () => {
    expect(resolveLocale("zh", ["en-US"])).toBe("zh");
    expect(resolveLocale("invalid", ["zh-CN", "en"])).toBe("zh");
    expect(resolveLocale(null, ["en-GB"])).toBe("en");
    expect(resolveLocale(null, [])).toBe("en");
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(LOCALES).toEqual(["en", "zh"]);
  });

  it("已知 API 错误码映射为本地化消息，未知错误使用安全回退", () => {
    expect(errorMessageKey(new ApiError(401, "INVALID_CREDENTIALS", "凭据错误"))).toBe("errors.invalidCredentials");
    expect(errorMessageKey(new ApiError(429, "RATE_LIMITED", "频繁"))).toBe("errors.rateLimited");
    expect(errorMessageKey(new ApiError(400, "INVALID_LANG", "语言"))).toBe("errors.invalidLang");
    expect(errorMessageKey(new TypeError("Failed to fetch"))).toBe("errors.network");
    expect(errorMessageKey(new ApiError(500, "INTERNAL", "内部错误"), "errors.runtime")).toBe("errors.runtime");
  });

  it("API 具体 message 优先展示，网络错误回退本地化文案", () => {
    const chinese = getTranslator("zh");
    expect(localizeError(
      new ApiError(400, "INVALID_ARGUMENT", "新密码不能与旧密码相同"),
      chinese,
      "password.failed",
    )).toBe("新密码不能与旧密码相同");
    expect(localizeError(new TypeError("Failed to fetch"), chinese, "password.failed"))
      .toBe(chinese("password.failed"));
  });

  it("只本地化未修改的工厂示例，不改写用户测试点", () => {
    const sample = { id: "t1", name: "样例", stdin: "", expected: "hello\n", mode: "eol" as const };
    expect(isFactoryFreeSample(sample)).toBe(true);
    expect(isFactoryFreeSample({ ...sample, name: "我的测试" })).toBe(false);
    expect(isFactoryFreeSample({ ...sample, expected: "custom\n" })).toBe(false);
  });

  it("语言切换入口保持单图标，不展示当前语言文字或下拉箭头", () => {
    for (const path of [
      "apps/web/src/components/LanguageSwitcher.tsx",
      "apps/admin/src/components/LanguageSwitcher.tsx",
    ]) {
      const source = fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      expect(source, path).toContain("<Globe2");
      expect(source, path).not.toContain("language-current");
      expect(source, path).not.toContain("ChevronDown");
      expect(source, path).toContain('data-testid="language-switcher"');
      expect(source, path).toContain('aria-haspopup="menu"');
      expect(source, path).toContain('role="menuitemradio"');
    }
  });

  it("学习端与管理面板 TSX 可见界面不残留硬编码中文", () => {
    const files: Array<{ path: string; source: string }> = [];
    const walk = (path: URL, rootPath: string) => {
      for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
        const url = new URL(entry.name, path);
        if (entry.isDirectory()) walk(new URL(entry.name + "/", path), rootPath);
        else if (entry.name.endsWith(".tsx")) files.push({ path: `${rootPath}${entry.name}`, source: fs.readFileSync(url, "utf8") });
      }
    };
    for (const rootPath of ["apps/web/src/", "apps/admin/src/"]) {
      walk(new URL(`../../${rootPath}`, import.meta.url), rootPath);
    }
    for (const { path, source } of files) {
      const visibleSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(visibleSource, `${path} 文案应通过共享 i18n 字典`).not.toMatch(/[\p{Script=Han}]/u);
    }
  });
});
