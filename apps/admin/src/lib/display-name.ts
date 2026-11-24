export interface DisplayNameSource {
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
}

/**
 * 名单导入或旧数据可能把无法编码的姓名写成 `?????` / 替换字符。
 * 这类值没有任何可读信息，界面应回退到用户名（其次是邮箱）。
 */
const PLACEHOLDER_DISPLAY_NAME = /^[?\uFF1F\uFFFD\s]+$/;

export function isPlaceholderDisplayName(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || PLACEHOLDER_DISPLAY_NAME.test(trimmed);
}

export function displayNameOf(user: DisplayNameSource | null | undefined): string {
  if (!user) return "";
  const displayName = user.display_name?.trim();
  if (displayName && !isPlaceholderDisplayName(displayName)) return displayName;
  return user.username?.trim() || user.email?.trim() || "";
}
