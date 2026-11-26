import { ApiError } from "../api";
import type { MessageKey, TranslateFn } from "./index";

const ERROR_KEYS: Record<string, MessageKey> = {
  INVALID_CREDENTIALS: "errors.invalidCredentials",
  RATE_LIMITED: "errors.rateLimited",
  USER_DISABLED: "errors.userDisabled",
  CURRENT_PASSWORD_INCORRECT: "errors.currentPassword",
  INVALID_ARGUMENT: "errors.invalidArgument",
  UNAUTHENTICATED: "errors.unauthenticated",
  FORBIDDEN: "errors.forbidden",
  PASSWORD_CHANGE_REQUIRED: "errors.unauthenticated",
  SETUP_COMPLETED: "errors.setupCompleted",
  BOOTSTRAP_COMPLETED: "errors.setupCompleted",
  INVALID_PACK: "errors.invalidPack",
  INVALID_PACK_PATH: "errors.invalidPack",
  COURSE_NOT_FOUND: "errors.courseNotFound",
  INVALID_LANG: "errors.invalidLang",
};

export function errorMessageKey(error: unknown, fallback: MessageKey = "errors.network"): MessageKey {
  return error instanceof ApiError ? ERROR_KEYS[error.code] ?? fallback : fallback;
}

export function localizeError(error: unknown, t: TranslateFn, fallback: MessageKey = "errors.network"): string {
  return t(errorMessageKey(error, fallback));
}
