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
  id: string; email: string; display_name: string | null; role: "admin" | "member";
  must_change_password: boolean;
}

export interface CourseInfo {
  id: string; slug: string; title: string; summary: string;
  langs: string[]; difficulty: string; version: number;
}

export type CoursePack = Record<string, string>;
export type Progress = Record<string, unknown>;

export const api = {
  setupStatus: () => request<{ needs_setup: boolean }>("/api/v1/setup/status"),
  setup: (instance_name: string, admin: { email: string; display_name?: string; password: string }) =>
    request<{ user: User }>("/api/v1/setup", { method: "POST", body: JSON.stringify({ instance_name, admin }) }),
  authStatus: () => request<{ needs_bootstrap: boolean; registration_enabled: boolean }>("/api/v1/auth/status"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/api/v1/me"),
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
