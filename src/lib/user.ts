import type { UserRow } from "../types";

/**
 * 名单导入或旧数据可能把无法编码的姓名写成 `?????` / 替换字符。
 * 这类值没有任何可读信息，应视同“未设置显示名”，由界面回退到用户名。
 */
const PLACEHOLDER_DISPLAY_NAME = /^[?\uFF1F\uFFFD\s]+$/;

export function normalizeDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDER_DISPLAY_NAME.test(trimmed)) return null;
  return trimmed;
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    display_name: normalizeDisplayName(user.display_name),
    role: user.role,
    status: user.status,
    must_change_password: user.must_change_password === 1,
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
  };
}
