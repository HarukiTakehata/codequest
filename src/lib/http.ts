import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { HttpError } from "./http-error";

export async function parseBody<T extends z.ZodTypeAny>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求体必须是 JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_ARGUMENT", parsed.error.issues[0]?.message ?? "参数不合法");
  }
  return parsed.data;
}
