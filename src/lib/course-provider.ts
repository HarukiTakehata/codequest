import type { Env } from "../types";
import { HttpError } from "./http-error";

/**
 * 通用课程契约：只描述课程目录、详情与内容包，不假设剧本格式、文件布局或引擎实现。
 * 当前版本没有接入任何课程实现，所有读取接口固定返回空目录 / 404。
 * 后续接入其它课程系统时，实现这些接口并替换 provider 即可，路由层无需改动。
 */
export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  langs: string[];
  difficulty: string;
  version: number;
}

export interface CourseFile {
  content: string;
  contentType: string;
}

export interface CourseProvider {
  list(): Promise<CourseSummary[]>;
  get(id: string): Promise<CourseSummary | null>;
  pack(id: string): Promise<Record<string, string> | null>;
  file(id: string, path: string): Promise<CourseFile | null>;
}

export interface AdminCourseSummary extends CourseSummary {
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminCourseProvider {
  listAll(): Promise<AdminCourseSummary[]>;
  upload(pack: Record<string, string>): Promise<AdminCourseSummary>;
  setEnabled(id: string, enabled: boolean): Promise<AdminCourseSummary | null>;
}

export const COURSE_DISABLED_MESSAGE = "当前版本暂不提供课程功能";

class DisabledCourseProvider implements CourseProvider, AdminCourseProvider {
  async list(): Promise<CourseSummary[]> {
    return [];
  }

  async get(): Promise<CourseSummary | null> {
    return null;
  }

  async pack(): Promise<Record<string, string> | null> {
    return null;
  }

  async file(): Promise<CourseFile | null> {
    return null;
  }

  async listAll(): Promise<AdminCourseSummary[]> {
    return [];
  }

  async upload(): Promise<AdminCourseSummary> {
    throw new HttpError(501, "COURSES_DISABLED", COURSE_DISABLED_MESSAGE);
  }

  async setEnabled(): Promise<AdminCourseSummary | null> {
    throw new HttpError(501, "COURSES_DISABLED", COURSE_DISABLED_MESSAGE);
  }
}

const disabledCourseProvider = new DisabledCourseProvider();

export function getCourseProvider(_env: Env): CourseProvider {
  return disabledCourseProvider;
}

export function getAdminCourseProvider(_env: Env): AdminCourseProvider {
  return disabledCourseProvider;
}
