import { getTranslator, type MessageKey, type TranslateFn, type TranslateVars } from "@codequest/i18n";

export interface ApiErrorShape {
  code: string;
  message: string;
  request_id: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let unauthorizedHandler: (() => void) | undefined;

export class LocalizedError extends Error {
  constructor(readonly messageKey: MessageKey, readonly vars?: TranslateVars) {
    super(messageKey);
    this.name = "LocalizedError";
  }
}

const errorMessageKeys: Record<string, MessageKey> = {
  INVALID_CREDENTIALS: "errors.invalidCredentials",
  RATE_LIMITED: "errors.rateLimited",
  USER_DISABLED: "errors.userDisabled",
  CURRENT_PASSWORD_INCORRECT: "errors.currentPassword",
  INVALID_ARGUMENT: "errors.invalidArgument",
  UNAUTHENTICATED: "errors.unauthenticated",
  FORBIDDEN: "errors.forbidden",
  INVALID_PACK: "errors.invalidPack",
  COURSE_NOT_FOUND: "errors.courseNotFound",
  INVALID_LANG: "errors.invalidLang",
  NETWORK_ERROR: "errors.network",
  INTERNAL: "admin.errors.internal",
  NOT_FOUND: "admin.errors.notFound",
  ACCOUNT_NOT_FOUND: "admin.errors.accountNotFound",
  INVALID_CSV: "admin.errors.invalidCsv",
  USERNAME_TAKEN: "admin.errors.usernameTaken",
  EMAIL_TAKEN: "admin.errors.emailTaken",
  LAST_ACTIVE_ADMIN: "admin.errors.lastActiveAdmin",
  LINK_EXPIRED: "admin.errors.linkExpired",
  BATCH_NOT_PENDING: "admin.errors.batchNotPending",
  CANNOT_RESET_OWN_PASSWORD: "admin.errors.cannotResetOwnPassword",
  PASSWORD_CHANGE_REQUIRED: "admin.errors.passwordChangeRequired",
};

const statusMessageKeys: Record<number, MessageKey> = {
  401: "errors.unauthenticated",
  403: "errors.forbidden",
  404: "admin.errors.notFound",
};

export function setUnauthorizedHandler(handler?: () => void) {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "");
  }

  if (!response.ok) {
    let body: { error?: Partial<ApiErrorShape> } = {};
    try {
      body = await response.json() as { error?: Partial<ApiErrorShape> };
    } catch {
      // Non-JSON errors omit the response body to avoid leaking sensitive data.
    }
    // A rejected current password is a form error, not an expired session.
    if (response.status === 401 && body.error?.code !== "CURRENT_PASSWORD_INCORRECT") unauthorizedHandler?.();
    throw new ApiError(
      response.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? "",
      body.error?.request_id,
    );
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json() as T;
  }
  return await response.text() as T;
}

export type UserRole = "student" | "teacher" | "admin";
export type AccountRole = Exclude<UserRole, "admin">;
export type ManagedAccountRole = UserRole;

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  status?: "active" | "disabled";
  must_change_password: boolean;
  created_at?: string;
  last_seen_at?: string | null;
}

export interface AdminConfig {
  instance_name: string;
  editor_url: string | null;
  learner_url: string | null;
  download_link_ttl_hours: number;
}

export interface IssuedBatch {
  id: string;
  filename: string;
  role: AccountRole;
  count: number;
  status: "pending" | "downloaded" | "expired" | "revoked";
  expires_at: string;
  downloaded_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  actor_id: string;
  actor_username: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminAccount {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: ManagedAccountRole;
  status: "active" | "disabled";
  must_change_password: boolean;
  created_at: string;
  last_seen_at: string | null;
  password_updated_at: string | null;
  batch_id: string | null;
  batch_filename: string | null;
}

export interface AdminCourse {
  id: string;
  slug: string;
  title: string;
  summary: string;
  langs: string[];
  difficulty: string;
  version: number;
  bytes?: number;
  sha256?: string;
  entry?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type CoursePack = Record<string, string>;

interface PageResult<T> {
  items?: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AccountStats {
  total: number;
  active: number;
  disabled: number;
  password_change_required: number;
}

export interface AdminOverview {
  accounts: AccountStats;
  teachers: AccountStats;
  courses: { total: number; enabled: number };
  batches: { pending: number; downloaded: number; expired: number; revoked: number };
  recent_batches: IssuedBatch[];
  recent_audit: AuditEvent[];
}

export interface BatchPreviewRow {
  username: string;
  email: string | null;
  display_name: string;
  password_mode: "generated" | "specified";
}

export interface BatchPreview {
  filename: string;
  count: number;
  generated_count: number;
  specified_count: number;
  rows: BatchPreviewRow[];
  conflicts: string[];
}

const admin = "/api/v1/admin";

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export const api = {
  authStatus: () => request<{
    needs_bootstrap: boolean;
    setup_url: string;
    auth_mode?: string;
    registration_enabled?: boolean;
  }>("/api/v1/auth/status"),
  login: (identifier: string, password: string) => request<{ user: AdminUser }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  }),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<{ user: AdminUser }>("/api/v1/me"),
  updateProfile: (display_name: string | null) => request<{ user: AdminUser }>("/api/v1/me", {
    method: "PATCH",
    body: JSON.stringify({ display_name }),
  }),
  changePassword: (currentPassword: string, newPassword: string) => request<{
    ok: boolean;
    reauth_required: boolean;
  }>("/api/v1/auth/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }),

  config: () => request<AdminConfig>(`${admin}/config`),
  overview: () => request<AdminOverview>(`${admin}/overview`),

  previewBatch: (csv: string, filename?: string, role: AccountRole = "student") => request<BatchPreview>(`${admin}/accounts/batch/preview`, {
    method: "POST",
    body: JSON.stringify({ csv, role, ...(filename?.trim() ? { filename: filename.trim() } : {}) }),
  }),
  createBatch: (csv: string, filename?: string, role: AccountRole = "student") => request<{
    batch: IssuedBatch;
    download_url: string;
  }>(`${admin}/accounts/batch`, {
    method: "POST",
    body: JSON.stringify({ csv, role, ...(filename?.trim() ? { filename: filename.trim() } : {}) }),
  }),
  batches: (limit: number, offset: number) => request<PageResult<IssuedBatch> & { batches: IssuedBatch[] }>(
    `${admin}/accounts/batches${query({ limit, offset })}`,
  ),
  revokeBatch: (id: string) => request<{ ok: true }>(`${admin}/accounts/batches/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }),

  accounts: (params: {
    query?: string;
    role?: ManagedAccountRole;
    status?: "active" | "disabled";
    passwordState?: "required" | "ready";
    limit: number;
    offset: number;
  }) => request<PageResult<AdminAccount> & { accounts: AdminAccount[] }>(
    `${admin}/accounts${query({
      query: params.query,
      role: params.role,
      status: params.status,
      password_state: params.passwordState,
      limit: params.limit,
      offset: params.offset,
    })}`,
  ),
  updateAccount: (id: string, patch: {
    username?: string;
    email?: string | null;
    display_name?: string;
    role?: ManagedAccountRole;
    status?: "active" | "disabled";
  }) => request<{
    account: AdminAccount;
  }>(`${admin}/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  resetPassword: (id: string) => request<{
    temporary_password: string;
    must_change_password: true;
  }>(`${admin}/accounts/${encodeURIComponent(id)}/password-reset`, { method: "POST" }),

  courses: () => request<{ courses: AdminCourse[] }>(`${admin}/courses`),
  uploadCourse: (pack: CoursePack) => request<{ course: AdminCourse }>(`${admin}/courses`, {
    method: "POST",
    body: JSON.stringify({ pack }),
  }),
  setCourseEnabled: (id: string, enabled: boolean) => request<{ course: AdminCourse }>(
    `${admin}/courses/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  ),

  audit: (limit: number, offset: number) => request<PageResult<AuditEvent> & { events: AuditEvent[] }>(
    `${admin}/audit${query({ limit, offset })}`,
  ),
};

export function errorMessage(error: unknown, t: TranslateFn = getTranslator("zh")): string {
  if (error instanceof LocalizedError) return t(error.messageKey, error.vars);
  if (error instanceof ApiError) {
    const key = errorMessageKeys[error.code] ?? statusMessageKeys[error.status];
    if (key) return t(key);
    if (error.message) return error.message;
  }
  if (error instanceof TypeError) return t("errors.network");
  if (error instanceof Error && error.message) return error.message;
  return t("admin.errors.unknown");
}

export function requestIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}
