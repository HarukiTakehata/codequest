export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** 可选：课程内容包存 R2；未配置时回落到 D1 pack_json（本地测试路径）。 */
  COURSE_PACKS?: R2Bucket;
  TOKEN_PEPPER: string;
  ENVIRONMENT?: string;
  AUTH_MODE?: "session";
  REGISTRATION_ENABLED?: string | boolean;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "member";
  status: "active" | "disabled";
  password_hash: string | null;
  password_updated_at: string | null;
  must_change_password: number;
  auth_version: number;
  last_seen_at: string | null;
  created_at: string;
}

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  langs: string;
  difficulty: string;
  entry: string;
  version: number;
  pack_json: string;
  pack_key: string;
  bytes: number;
  sha256: string;
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
