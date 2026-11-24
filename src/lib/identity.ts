import { z } from "zod";

const USERNAME_ALLOWED = /^[\p{L}\p{N}._-]+$/u;
const EMAIL_SCHEMA = z.string().email();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase();
  const length = Array.from(username).length;
  if (length < 3 || length > 32) throw new Error("用户名长度须为 3–32 个字符");
  if (!USERNAME_ALLOWED.test(username)) throw new Error("用户名只能包含 Unicode 字母、数字及 ._-");
  return username;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254) throw new Error("邮箱最长 254 个字符");
  if (CONTROL_CHARACTERS.test(email) || !EMAIL_SCHEMA.safeParse(email).success) throw new Error("邮箱格式不正确");
  return email;
}

function normalizedString<T>(normalize: (value: string) => T) {
  return z.string().transform((value, ctx) => {
    try {
      return normalize(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "参数不合法" });
      return z.NEVER;
    }
  });
}

export const usernameSchema = normalizedString(normalizeUsername);
export const emailSchema = z.string().nullable().transform((value, ctx) => {
  try {
    return normalizeEmail(value);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "参数不合法" });
    return z.NEVER;
  }
});
export const identifierSchema = z.string().trim().min(1).max(254).transform((value) => value.toLowerCase());

/** 将 SQLite/D1 唯一约束错误映射为稳定的 HTTP 冲突码。 */
export function identityConflict(error: unknown): { code: "USERNAME_TAKEN" | "EMAIL_TAKEN"; message: string } | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed:\s*users\.username\b/i.test(message)) {
    return { code: "USERNAME_TAKEN", message: "用户名已被使用" };
  }
  if (/UNIQUE constraint failed:\s*users\.email\b/i.test(message)) {
    return { code: "EMAIL_TAKEN", message: "邮箱已被使用" };
  }
  return null;
}
