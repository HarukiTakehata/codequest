import { isPlaceholderDisplayName } from "./display-name";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

export function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function initials(name: string | null | undefined, username?: string | null, email?: string | null): string {
  const source = [name, username, email]
    .map((value) => value?.trim())
    .find((value) => value && !isPlaceholderDisplayName(value)) ?? "";
  return source ? source.slice(0, 1).toUpperCase() : "?";
}

export const batchStatusLabels = {
  pending: "待领取",
  downloaded: "已领取",
  expired: "已过期",
  revoked: "已撤销",
} as const;

export const auditTargetLabels: Record<string, string> = {
  user: "成员账号",
  account: "成员账号",
  course: "课程",
  batch: "发号批次",
  issued_batch: "发号批次",
  system: "系统",
};

export const auditActionLabels: Record<string, string> = {
  "batch.created": "创建发号批次",
  "batch.revoked": "撤销发号批次",
  "batch.downloaded": "领取发放表",
  "batch_created": "创建发号批次",
  "batch_revoked": "撤销发号批次",
  "batch_downloaded": "领取发放表",
  "account.created": "批量创建账号",
  "account.updated": "更新账号",
  "account.enabled": "启用账号",
  "account.disabled": "停用账号",
  "account.password_reset": "重置临时密码",
  "account_password_reset": "重置临时密码",
  "account_updated": "更新账号",
  "course.created": "上传课程",
  "course.updated": "更新课程",
  "course.enabled": "上架课程",
  "course.disabled": "下架课程",
  "course_created": "上传课程",
  "course_updated": "更新课程",
  "course_published": "发布课程",
};

export function auditActionLabel(action: string): string {
  return auditActionLabels[action] ?? action.replaceAll("_", " ");
}
