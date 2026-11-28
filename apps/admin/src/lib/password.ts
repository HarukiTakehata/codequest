import type { MessageKey } from "@codequest/i18n";

export const MIN_ADMIN_PASSWORD_LENGTH = 10;

/** Client-side validation mirrored by the server; the server remains authoritative. */
export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): MessageKey | null {
  if (!currentPassword) return "admin.errors.currentPasswordRequired";
  if (!newPassword) return "admin.errors.newPasswordRequired";
  if (newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) return "admin.errors.passwordTooShort";
  if (newPassword !== confirmPassword) return "admin.errors.passwordMismatch";
  if (newPassword === currentPassword) return "admin.errors.passwordSameAsCurrent";
  return null;
}
