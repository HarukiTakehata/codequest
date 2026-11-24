import { describe, expect, it } from "vitest";
import { parseRoster, rosterToCsv } from "../../src/lib/csv";
import { normalizeEmail, normalizeUsername } from "../../src/lib/identity";
import { normalizeDisplayName } from "../../src/lib/user";

describe("账号标识规范化", () => {
  it("用户名 trim+lowercase，支持 Unicode 字母/数字及 ._-", () => {
    expect(normalizeUsername("  USER.用户_42-  ")).toBe("user.用户_42-");
    expect(normalizeUsername("ÄBC")).toBe("äbc");
    expect(normalizeUsername("a".repeat(32))).toHaveLength(32);
    expect(normalizeUsername("用".repeat(32))).toHaveLength(32);
  });

  it("拒绝缺失、过短/过长及非法用户名", () => {
    for (const value of ["", "ab", "a".repeat(33), "用".repeat(33), "bad name", "a@b", "a/b", "a\u0301"]) {
      expect(() => normalizeUsername(value), value).toThrow();
    }
  });

  it("邮箱可选、trim+lowercase，空值统一为 null", () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("  User.Tag+Test@Example.COM ")).toBe("user.tag+test@example.com");
    for (const value of ["not-an-email", "a@b", "=formula@example.test", "a b@example.test"]) {
      expect(() => normalizeEmail(value), value).toThrow();
    }
  });

  it("显示名中的占位符与乱码视为未设置", () => {
    expect(normalizeDisplayName(undefined)).toBeNull();
    expect(normalizeDisplayName(null)).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("?????")).toBeNull();
    expect(normalizeDisplayName("？？？")).toBeNull();
    expect(normalizeDisplayName("\uFFFD\uFFFD")).toBeNull();
    expect(normalizeDisplayName(" Alice ")).toBe("Alice");
  });

  it("CSV 中乱码显示名回退到用户名", () => {
    expect(parseRoster("username,email,display_name\nj2600702,,?????\n")[0]).toMatchObject({
      username: "j2600702", display_name: "j2600702",
    });
  });

  it("CSV 固定三/四列，支持空邮箱、默认显示名与规范化", () => {
    expect(parseRoster("username,email,display_name\n Alice , ALICE@Example.Test ,\n用户名,,,")).toEqual([
      { username: "alice", email: "alice@example.test", display_name: "alice", line: 2 },
      { username: "用户名", email: null, display_name: "用户名", line: 3 },
    ]);
    expect(parseRoster("bob,,Bob,specified-password-123")[0]).toEqual({
      username: "bob", email: null, display_name: "Bob", password: "specified-password-123", line: 1,
    });
    expect(() => parseRoster("email,display_name\nalice@example.test,Alice")).toThrow(/每行/);
    expect(() => parseRoster("alice,alice@example.test")).toThrow(/三列或四列/);
  });

  it("CSV 导出固定为 username,email,display_name,password，并保留空邮箱", () => {
    const csv = rosterToCsv([{ username: "alice", email: null, display_name: "Alice", password: "Cq!generated" }]);
    expect(csv.startsWith("\uFEFFusername,email,display_name,password\nalice,,Alice,Cq!generated\n")).toBe(true);
    expect(parseRoster(csv)[0]).toMatchObject({ username: "alice", email: null, display_name: "Alice" });
  });
});
