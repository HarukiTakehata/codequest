import { describe, expect, it } from "vitest";
import { en } from "../../apps/web/src/i18n/en";
import { zh } from "../../apps/web/src/i18n/zh";
import { getTranslator, htmlLang, isLocale, LOCALES, resolveLocale } from "../../apps/web/src/i18n";
import { errorMessageKey } from "../../apps/web/src/i18n/errors";
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

  it("只本地化未修改的工厂示例，不改写用户测试点", () => {
    const sample = { id: "t1", name: "样例", stdin: "", expected: "hello\n", mode: "eol" as const };
    expect(isFactoryFreeSample(sample)).toBe(true);
    expect(isFactoryFreeSample({ ...sample, name: "我的测试" })).toBe(false);
    expect(isFactoryFreeSample({ ...sample, expected: "custom\n" })).toBe(false);
  });

  it("TSX 可见界面不残留硬编码中文", () => {
    const files: string[] = [];
    const walk = (path: URL) => {
      for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
        const url = new URL(entry.name, path);
        if (entry.isDirectory()) walk(new URL(entry.name + "/", path));
        else if (entry.name.endsWith(".tsx")) files.push(fs.readFileSync(url, "utf8"));
      }
    };
    walk(new URL("../../apps/web/src/", import.meta.url));
    for (const source of files) {
      const visibleSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(visibleSource, "界面文案应通过 i18n 字典").not.toMatch(/[\p{Script=Han}]/u);
    }
  });
});
