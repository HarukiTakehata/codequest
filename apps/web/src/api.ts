export interface ApiErrorShape { code: string; message: string }
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    let body: { error?: ApiErrorShape } = {};
    try { body = await response.json() as { error?: ApiErrorShape }; } catch { /* ignore */ }
    throw new ApiError(response.status, body.error?.code ?? "UNKNOWN", body.error?.message ?? response.statusText);
  }
  if (response.headers.get("Content-Type")?.includes("json")) return await response.json() as T;
  return await response.text() as T;
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: "student" | "teacher" | "admin";
  must_change_password: boolean;
  created_at?: string;
  last_seen_at?: string | null;
}

export interface SetupStatus {
  needs_setup: boolean;
  instance_name?: string | null;
  admin_url?: string | null;
}

export interface CourseInfo {
  id: string; slug: string; title: string; summary: string;
  langs: string[]; difficulty: string; version: number;
}

export type CoursePack = Record<string, string>;
export type Progress = Record<string, unknown>;

export const api = {
  setupStatus: () => request<SetupStatus>("/api/v1/setup/status"),
  setup: (instance_name: string, admin: { username: string; email?: string | null; display_name?: string; password: string }) =>
    request<{ user: User; instance_name: string }>("/api/v1/setup", {
      method: "POST", body: JSON.stringify({ instance_name, admin }),
    }),
  login: (identifier: string, password: string) =>
    request<{ user: User }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/api/v1/me"),
  updateProfile: (display_name: string | null) =>
    request<{ user: User }>("/api/v1/me", {
      method: "PATCH", body: JSON.stringify({ display_name }),
    }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>("/api/v1/auth/password", {
      method: "POST", body: JSON.stringify({ current_password, new_password }),
    }),
  courses: () => request<{ courses: CourseInfo[] }>("/api/v1/courses"),
  pack: (id: string) => request<{ pack: CoursePack }>(`/api/v1/courses/${id}/pack`),
  progress: (id: string) => request<{ progress: Progress }>(`/api/v1/progress/${id}`),
  saveProgress: (id: string, progress: Progress) =>
    request<{ progress: Progress }>(`/api/v1/progress/${id}`, {
      method: "PUT", body: JSON.stringify(progress),
    }),
};

export interface FreeTestCase {
  id: string;
  name: string;
  stdin: string;
  expected: string;
  mode: "exact" | "eol" | "ws" | "regex-line" | "numeric-tol";
}
export interface FreeformDraft {
  lang: string;
  code: string;
  stdin: string;
  testcases: FreeTestCase[];
  updated_at?: string;
}

export const freeform = {
  list: () => request<{ drafts: Record<string, FreeformDraft>; templates: Record<string, string> }>("/api/v1/freeform"),
  get: (lang: string) => request<{ draft: FreeformDraft }>(`/api/v1/freeform/${lang}`),
  save: (lang: string, draft: Omit<FreeformDraft, "lang" | "updated_at">) =>
    request<{ draft: FreeformDraft }>(`/api/v1/freeform/${lang}`, {
      method: "PUT", body: JSON.stringify(draft),
    }),
};
