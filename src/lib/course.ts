import { z } from "zod";
import type { Database, DbStatement } from "../db";
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
  presetFiles: z.record(z.string(), z.string()).default({}),
  termMode: z.enum(["script", "explore"]).optional(),
  token: z.string().optional(),
  hint: z.string().optional(),
});

const scriptExpectationSchema = z.record(z.string(), z.unknown()).refine(
  (expect) => Object.keys(expect).length > 0,
  "脚本测试点至少需要一个 expect 断言",
);

const scriptCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  weight: z.number().finite().positive().optional(),
  call: z.object({ fn: z.string().min(1), args: z.array(z.unknown()).optional() }).optional(),
  fire: z.string().min(1).optional(),
  emit: z.object({ signal: z.string().min(1), payload: z.unknown().optional() }).optional(),
  world: z.record(z.string(), z.unknown()).optional(),
  dice: z.array(z.number()).optional(),
  choices: z.array(z.number().int()).optional(),
  expect: scriptExpectationSchema,
}).strict().refine(
  (test) => [test.call, test.fire, test.emit].filter((run) => run !== undefined).length === 1,
  "脚本测试点必须且只能指定 call/fire/emit 之一",
);

const oiJudgeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("oi").default("oi"),
  cases: z.array(z.object({
    id: z.string(), name: z.string(), stdin: z.string(), expected: z.string(),
    mode: z.enum(["exact", "eol", "ws", "regex-line", "numeric-tol"]).optional(),
    weight: z.number().optional(), tolerance: z.number().optional(),
  })).min(1),
});

const scriptJudgeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("script"),
  init: z.record(z.string(), z.unknown()).default({}),
  catalog: z.record(z.string(), z.array(z.string())).optional(),
  requiredExports: z.array(z.string().min(1)).optional(),
  limits: z.object({
    steps: z.number().int().positive(),
    iterations: z.number().int().positive(),
    maxString: z.number().int().positive().optional(),
    maxList: z.number().int().positive().optional(),
    depth: z.number().int().positive().optional(),
  }).strict().optional(),
  cases: z.array(scriptCaseSchema).min(1),
}).strict();

const judgeSchema = z.discriminatedUnion("kind", [oiJudgeSchema, scriptJudgeSchema]);

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
  const judgeIds = new Set<string>();
  for (const [path, content] of Object.entries(pack)) {
    if (!/^judges\/[^/]+\.json$/.test(path)) continue;
    try {
      const judge = judgeSchema.parse(JSON.parse(content));
      if (judgeIds.has(judge.id)) throw new Error(`判题 id 重复: ${judge.id}`);
      judgeIds.add(judge.id);
      judges.push(judge);
    } catch (error) {
      throw new HttpError(400, "INVALID_PACK", `${path} 校验失败: ${String(error)}`);
    }
  }
  for (const challenge of challenges) {
    if (challenge.judge && !judges.some((j) => j.id === challenge.judge)) {
      throw new HttpError(400, "INVALID_PACK", `${challenge.id} 引用的判题配置不存在: ${challenge.judge}`);
    }
    const judge = judges.find((candidate) => candidate.id === challenge.judge);
    if (judge?.kind === "script" && (challenge.lang !== "javascript" || challenge.mode !== "code")) {
      throw new HttpError(400, "INVALID_PACK", `${challenge.id} 的脚本判题要求 lang=javascript、mode=code`);
    }
  }
  return { meta, challenges, judges };
}

export function packBytes(pack: CoursePack): number {
  return new TextEncoder().encode(JSON.stringify(pack)).length;
}

// 当前上传 API 的统一限制；R2 主存储不再受 D1 单行上限约束。
export const MAX_COURSE_PACK_BYTES = 1_500_000;

export function assertCoursePackSize(pack: CoursePack): void {
  if (packBytes(pack) > MAX_COURSE_PACK_BYTES) {
    throw new HttpError(413, "PACK_TOO_LARGE", "课程包编码后不能超过 1.5 MB");
  }
}

export interface PreparedCoursePackWrite {
  row: CourseRow;
  statement: DbStatement;
  cleanup: () => Promise<void>;
}

class CoursePackVersionConflict extends Error {}

function isCoursePackConflict(error: unknown): boolean {
  return error instanceof CoursePackVersionConflict ||
    /UNIQUE constraint failed:\s*courses\.(?:id|slug)/i.test(error instanceof Error ? error.message : String(error));
}

/** 暂存 R2 正文并准备带版本 CAS 的 D1 元数据语句，供上传与初始化共用。 */
export async function prepareCoursePackWrite(
  env: Env, db: Database, pack: CoursePack, adminId: string,
  existing: CourseRow | null, courseId = newId("crs"),
): Promise<PreparedCoursePackWrite> {
  assertCoursePackSize(pack);
  const { meta } = validatePack(pack);
  const now = nowIso();
  const packJson = JSON.stringify(pack);
  const bytes = new TextEncoder().encode(packJson).length;
  const sha256 = await sha256Hex(packJson);
  const expectedVersion = existing?.version ?? 0;
  const row: CourseRow = {
    id: existing?.id ?? courseId,
    slug: meta.slug, title: meta.title, summary: meta.summary,
    langs: meta.langs.join(","), difficulty: meta.difficulty, entry: meta.entry,
    version: expectedVersion + 1,
    pack_json: env.COURSE_PACKS ? null : packJson,
    // 尝试唯一 key：并发失败方只能清理自己的对象，不能覆盖或删除获胜方正文。
    pack_key: `courses/${existing?.id ?? courseId}/${expectedVersion + 1}/${newId("upl")}.json`,
    bytes, sha256,
    enabled: 1, created_by: adminId, created_at: existing?.created_at ?? now, updated_at: now,
  };
  let staged = false;
  if (env.COURSE_PACKS) {
    try {
      await env.COURSE_PACKS.put(row.pack_key, packJson, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { sha256: row.sha256, course_id: row.id },
      });
      staged = true;
    } catch {
      throw new HttpError(503, "COURSE_PACK_WRITE_FAILED", "课程包存储写入失败，请稍后重试");
    }
  }
  const statement = db.prepare(`INSERT INTO courses
    (id, slug, title, summary, langs, difficulty, entry, version, pack_json, pack_key, bytes, sha256, enabled, created_by, created_at, updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, langs=excluded.langs,
      difficulty=excluded.difficulty, entry=excluded.entry, version=excluded.version,
      pack_json=excluded.pack_json, pack_key=excluded.pack_key, bytes=excluded.bytes,
      sha256=excluded.sha256, enabled=1, updated_at=excluded.updated_at
    WHERE courses.version = ?17`)
    .bind(row.id, row.slug, row.title, row.summary, row.langs, row.difficulty, row.entry,
      row.version, row.pack_json, row.pack_key, row.bytes, row.sha256, row.enabled,
      row.created_by, row.created_at, row.updated_at, expectedVersion);
  return {
    row,
    statement,
    cleanup: async () => {
      if (staged && env.COURSE_PACKS) await env.COURSE_PACKS.delete(row.pack_key).catch(() => undefined);
    },
  };
}

export async function saveCoursePack(
  env: Env, db: Database, pack: CoursePack, adminId: string,
  additionalStatements?: (row: CourseRow) => DbStatement[],
): Promise<CourseRow> {
  const courseId = newId("crs");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { meta } = validatePack(pack);
    const existing = await db.prepare("SELECT * FROM courses WHERE slug = ?1").bind(meta.slug).first<CourseRow>();
    const prepared = await prepareCoursePackWrite(env, db, pack, adminId, existing, courseId);
    try {
      const results = await db.batch([prepared.statement, ...(additionalStatements?.(prepared.row) ?? [])]);
      if (results[0]!.changes !== 1) throw new CoursePackVersionConflict();
      return prepared.row;
    } catch (error) {
      await prepared.cleanup();
      if (isCoursePackConflict(error) && attempt < 2) continue;
      if (isCoursePackConflict(error)) throw new HttpError(409, "COURSE_VERSION_CONFLICT", "课程版本冲突，请重试");
      throw error;
    }
  }
  throw new HttpError(409, "COURSE_VERSION_CONFLICT", "课程版本冲突，请重试");
}

function parseStoredPack(raw: string): CoursePack {
  try {
    const pack = JSON.parse(raw) as unknown;
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new Error("invalid pack");
    if (!Object.values(pack).every((value) => typeof value === "string")) throw new Error("invalid pack value");
    return pack as CoursePack;
  } catch {
    throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包内容损坏或暂不可用");
  }
}

async function verifiedStoredPack(raw: string, row: CourseRow): Promise<CoursePack> {
  if (new TextEncoder().encode(raw).length !== row.bytes || await sha256Hex(raw) !== row.sha256) {
    throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包完整性校验失败");
  }
  return parseStoredPack(raw);
}

/** 配置 R2 时只读 R2；未配置 R2 时只读 D1 本地正文。 */
export async function readCoursePack(env: Env, row: CourseRow): Promise<CoursePack> {
  if (env.COURSE_PACKS) {
    let object: R2ObjectBody | null;
    try {
      object = await env.COURSE_PACKS.get(row.pack_key);
    } catch {
      throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包存储暂不可用，请稍后重试");
    }
    if (!object) throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包对象缺失");
    if (object.size !== row.bytes) {
      throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包完整性校验失败");
    }
    let raw: string;
    try {
      raw = await object.text();
    } catch {
      throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包读取失败，请稍后重试");
    }
    return verifiedStoredPack(raw, row);
  }
  if (row.pack_json === null) {
    throw new HttpError(503, "COURSE_PACK_UNAVAILABLE", "课程包存储未配置或内容缺失");
  }
  return verifiedStoredPack(row.pack_json, row);
}

export function publicCourse(row: CourseRow) {
  return {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary,
    langs: row.langs.split(",").filter(Boolean), difficulty: row.difficulty,
    entry: row.entry, version: row.version, bytes: row.bytes, sha256: row.sha256,
  };
}
