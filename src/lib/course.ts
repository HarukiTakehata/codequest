import { z } from "zod";
import { sha256Hex } from "./crypto";
import { newId } from "./ids";
import { nowIso } from "./time";
import type { CourseRow, Env } from "../types";
import { HttpError } from "./http-error";

const courseSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  langs: z.array(z.string()).default([]),
  difficulty: z.string().default("beginner"),
  entry: z.string().default("start.txt"),
});

const goalSchema = z.object({
  id: z.string(), text: z.string(), hint: z.string().optional(), hidden: z.boolean().optional(),
  check: z.object({
    kind: z.string(), pattern: z.string().optional(), flags: z.string().optional(),
    value: z.union([z.string(), z.number()]).optional(), path: z.string().optional(),
    command: z.string().optional(), expect: z.string().optional(),
    all: z.boolean().optional(), id: z.string().optional(),
  }).passthrough(),
});

const challengeSchema = z.object({
  id: z.string(), title: z.string(), description: z.string().default(""),
  lang: z.enum(["javascript", "python", "cpp", "shell", "java"]),
  mode: z.enum(["code", "term"]).default("code"),
  template: z.string().default(""),
  judge: z.string().optional(),
  goals: z.array(goalSchema).default([]),
  requireAllGoals: z.boolean().default(false),
  presetFiles: z.record(z.string()).default({}),
  termMode: z.enum(["script", "explore"]).optional(),
  token: z.string().optional(),
  hint: z.string().optional(),
});

const judgeSchema = z.object({
  id: z.string(),
  cases: z.array(z.object({
    id: z.string(), name: z.string(), stdin: z.string(), expected: z.string(),
    mode: z.enum(["exact", "eol", "ws", "regex-line", "numeric-tol"]).optional(),
    weight: z.number().optional(), tolerance: z.number().optional(),
  })),
});

export type CoursePack = Record<string, string>;

export interface ValidatedPack {
  meta: z.infer<typeof courseSchema>;
  challenges: z.infer<typeof challengeSchema>[];
  judges: z.infer<typeof judgeSchema>[];
}

/** 管理端上传时的 schema 校验（M5 前置：格式先行）。 */
export function validatePack(pack: CoursePack): ValidatedPack {
  for (const path of Object.keys(pack)) {
    if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\\")) {
      throw new HttpError(400, "INVALID_PACK_PATH", `非法课程包路径: ${path}`);
    }
  }
  const rawCourse = pack["course.json"];
  if (!rawCourse) throw new HttpError(400, "INVALID_PACK", "缺少 course.json");
  let meta: z.infer<typeof courseSchema>;
  try {
    meta = courseSchema.parse(JSON.parse(rawCourse));
  } catch (error) {
    throw new HttpError(400, "INVALID_PACK", `course.json 校验失败: ${String(error)}`);
  }
  if (!pack[meta.entry]) throw new HttpError(400, "INVALID_PACK", `缺少入口剧本 ${meta.entry}`);

  const challenges: ValidatedPack["challenges"] = [];
  for (const [path, content] of Object.entries(pack)) {
    if (!/^challenges\/[^/]+\.json$/.test(path)) continue;
    try {
      challenges.push(challengeSchema.parse(JSON.parse(content)));
    } catch (error) {
      throw new HttpError(400, "INVALID_PACK", `${path} 校验失败: ${String(error)}`);
    }
  }
  const judges: ValidatedPack["judges"] = [];
  for (const [path, content] of Object.entries(pack)) {
    if (!/^judges\/[^/]+\.json$/.test(path)) continue;
    try {
      judges.push(judgeSchema.parse(JSON.parse(content)));
    } catch (error) {
      throw new HttpError(400, "INVALID_PACK", `${path} 校验失败: ${String(error)}`);
    }
  }
  for (const challenge of challenges) {
    if (challenge.judge && !judges.some((j) => j.id === challenge.judge)) {
      throw new HttpError(400, "INVALID_PACK", `${challenge.id} 引用的判题配置不存在: ${challenge.judge}`);
    }
  }
  return { meta, challenges, judges };
}

export function packBytes(pack: CoursePack): number {
  return new TextEncoder().encode(JSON.stringify(pack)).length;
}

export async function saveCoursePack(
  env: Env, pack: CoursePack, adminId: string,
): Promise<CourseRow> {
  const validated = validatePack(pack);
  const { meta } = validated;
  const existing = await env.DB.prepare("SELECT * FROM courses WHERE slug = ?1").bind(meta.slug).first<CourseRow>();
  const now = nowIso();
  const row: CourseRow = {
    id: existing?.id ?? newId("crs"),
    slug: meta.slug, title: meta.title, summary: meta.summary,
    langs: meta.langs.join(","), difficulty: meta.difficulty, entry: meta.entry,
    version: (existing?.version ?? 0) + 1,
    pack_json: JSON.stringify(pack),
    pack_key: `courses/${meta.slug}/${(existing?.version ?? 0) + 1}/pack.json`,
    bytes: packBytes(pack), sha256: await sha256Hex(JSON.stringify(pack)),
    enabled: 1, created_by: adminId, created_at: existing?.created_at ?? now, updated_at: now,
  };
  await env.DB.prepare(`INSERT INTO courses
    (id, slug, title, summary, langs, difficulty, entry, version, pack_json, pack_key, bytes, sha256, enabled, created_by, created_at, updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, langs=excluded.langs,
      difficulty=excluded.difficulty, entry=excluded.entry, version=excluded.version,
      pack_json=excluded.pack_json, pack_key=excluded.pack_key, bytes=excluded.bytes,
      sha256=excluded.sha256, enabled=1, updated_at=excluded.updated_at`)
    .bind(row.id, row.slug, row.title, row.summary, row.langs, row.difficulty, row.entry,
      row.version, row.pack_json, row.pack_key, row.bytes, row.sha256, row.enabled,
      row.created_by, row.created_at, row.updated_at).run();
  if (env.COURSE_PACKS) {
    await env.COURSE_PACKS.put(row.pack_key, row.pack_json, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: row.sha256, course_id: row.id },
    });
  }
  return row;
}

export function readPack(row: CourseRow): CoursePack {
  return JSON.parse(row.pack_json) as CoursePack;
}

export function publicCourse(row: CourseRow) {
  return {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary,
    langs: row.langs.split(",").filter(Boolean), difficulty: row.difficulty,
    entry: row.entry, version: row.version, bytes: row.bytes, sha256: row.sha256,
  };
}
