export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** 课程内容包主存储；未配置时只使用 D1 pack_json（本地测试路径）。 */
  COURSE_PACKS?: R2Bucket;
  TOKEN_PEPPER: string;
  ENVIRONMENT?: string;
  AUTH_MODE?: "session";
  REGISTRATION_ENABLED?: string | boolean;
  /**
   * 可选：会话 Cookie 的 Domain。部署到 admin./editor. 这类独立子域时设为父域
   * （例如 `.example.com`），让编辑器能复用管理面板的管理员会话。
   */
  SESSION_COOKIE_DOMAIN?: string;
  /** 独立管理面板与编辑器的跳转地址；未配置时管理 API 返回 null。 */
  EDITOR_URL?: string;
  LEARNER_URL?: string;
  /** 学习端管理入口；未配置时 setup/status 返回 /admin/。 */
  ADMIN_URL?: string;
}

export type UserRole = "student" | "teacher" | "admin";

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
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
  pack_json: string | null;
  pack_key: string;
  bytes: number;
  sha256: string;
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
