import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { nowIso } from "../lib/time";
import { requireUser } from "../middleware/identity";

export const progressRoutes = new Hono<AppEnv>();
progressRoutes.use("*", requireUser);

export interface ProgressData {
  scene?: string;
  pointer?: number;
  vars?: Record<string, unknown>;
  challenges?: Record<string, { passed: boolean; score: number; code?: string }>;
  hints?: string[];
  updated_at?: string;
  [key: string]: unknown;
}

export function emptyProgress(): ProgressData {
  return { scene: "start.txt", pointer: 0, vars: {}, challenges: {}, hints: [] };
}

/** 离线改动合并：对象字段按 key 合并，hints 取并集，标量以新值覆盖（设计 §7.1 R8）。 */
export function mergeProgress(old: ProgressData, incoming: ProgressData): ProgressData {
  const mergeMap = (a: unknown, b: unknown) => ({ ...(a ?? {}), ...(b ?? {}) });
  return {
    ...old,
    ...incoming,
    vars: mergeMap(old.vars, incoming.vars),
    challenges: mergeMap(old.challenges, incoming.challenges),
    hints: [...new Set([...(old.hints ?? []), ...(incoming.hints ?? [])])],
  };
}

progressRoutes.get("/progress/:courseId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT data_json, updated_at FROM progress WHERE user_id = ?1 AND course_id = ?2",
  ).bind(c.get("user").id, c.req.param("courseId")).first<{ data_json: string; updated_at: string }>();
  return c.json({ progress: row ? JSON.parse(row.data_json) as ProgressData : emptyProgress() });
});

progressRoutes.put("/progress/:courseId", async (c) => {
  const incoming = await parseBody(c, z.record(z.unknown())) as ProgressData;
  const courseId = c.req.param("courseId");
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare(
    "SELECT data_json FROM progress WHERE user_id = ?1 AND course_id = ?2",
  ).bind(userId, courseId).first<{ data_json: string }>();
  const merged = mergeProgress(row ? JSON.parse(row.data_json) as ProgressData : emptyProgress(), incoming);
  merged.updated_at = nowIso();
  await c.env.DB.prepare(`INSERT INTO progress (user_id, course_id, data_json, updated_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(user_id, course_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
    .bind(userId, courseId, JSON.stringify(merged), merged.updated_at).run();
  return c.json({ progress: merged });
});
