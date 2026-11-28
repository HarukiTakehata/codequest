import type { MessageKey, Locale, TranslateFn } from "@codequest/i18n";
import type { IssuedBatch } from "../api";
import { isPlaceholderDisplayName } from "./display-name";

const dateFormatters: Record<Locale, Intl.DateTimeFormat> = {
  zh: new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
  en: new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
};

export function formatDate(value: string | null | undefined, locale: Locale = "zh"): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatters[locale].format(date);
}

export function formatNumber(value: number, locale: Locale = "zh", options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", options).format(value);
}

export function formatBytes(value: number | undefined, locale: Locale = "zh"): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${formatNumber(value, locale)} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const formatted = formatNumber(size, locale, {
    minimumFractionDigits: size >= 10 ? 1 : 2,
    maximumFractionDigits: size >= 10 ? 1 : 2,
  });
  return `${formatted} ${units[index]}`;
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

const batchStatusMessageKeys: Record<IssuedBatch["status"], MessageKey> = {
  pending: "admin.batchStatus.pending",
  downloaded: "admin.batchStatus.downloaded",
  expired: "admin.batchStatus.expired",
  revoked: "admin.batchStatus.revoked",
};

const auditTargetMessageKeys: Record<string, MessageKey> = {
  user: "admin.audit.target.user",
  account: "admin.audit.target.user",
  course: "admin.audit.target.course",
  batch: "admin.audit.target.batch",
  issued_batch: "admin.audit.target.batch",
  system: "admin.audit.target.system",
};

const auditActionMessageKeys: Record<string, MessageKey> = {
  "batch.created": "admin.audit.action.batchCreated",
  "batch.revoked": "admin.audit.action.batchRevoked",
  "batch.downloaded": "admin.audit.action.batchDownloaded",
  "batch_created": "admin.audit.action.batchCreated",
  "batch_revoked": "admin.audit.action.batchRevoked",
  "batch_downloaded": "admin.audit.action.batchDownloaded",
  "account.created": "admin.audit.action.accountCreated",
  "account.updated": "admin.audit.action.accountUpdated",
  "account.enabled": "admin.audit.action.accountEnabled",
  "account.disabled": "admin.audit.action.accountDisabled",
  "account.password_reset": "admin.audit.action.passwordReset",
  "account_password_reset": "admin.audit.action.passwordReset",
  "password_reset": "admin.audit.action.passwordReset",
  "account_updated": "admin.audit.action.accountUpdated",
  "course.created": "admin.audit.action.courseCreated",
  "course.updated": "admin.audit.action.courseUpdated",
  "course.enabled": "admin.audit.action.courseEnabled",
  "course.disabled": "admin.audit.action.courseDisabled",
  "course_created": "admin.audit.action.courseCreated",
  "course_updated": "admin.audit.action.courseUpdated",
  "course_published": "admin.audit.action.coursePublished",
};

export function batchStatusLabel(status: IssuedBatch["status"], t: TranslateFn): string {
  return t(batchStatusMessageKeys[status]);
}

export function auditTargetLabel(targetType: string, t: TranslateFn): string {
  const key = auditTargetMessageKeys[targetType];
  return key ? t(key) : targetType;
}

export function auditActionLabel(action: string, t: TranslateFn): string {
  const key = auditActionMessageKeys[action];
  return key ? t(key) : action.replaceAll("_", " ");
}
