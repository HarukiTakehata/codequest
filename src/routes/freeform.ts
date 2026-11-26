import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { HttpError } from "../lib/http-error";
import { parseBody } from "../lib/http";
import { nowIso } from "../lib/time";
import { requireUser } from "../middleware/identity";

export const freeformRoutes = new Hono<AppEnv>();
freeformRoutes.use("*", requireUser);

const LANGS = ["javascript", "python", "cpp", "shell", "java"] as const;
export const FREE_TEMPLATES: Record<(typeof LANGS)[number], string> = {
  javascript: '// 自由模式 · JavaScript\n// console.log 输出；readline() 逐行读 stdin\nconsole.log("hello");\n',
  python: '# 自由模式 · Python\n# input() 读 stdin；print() 输出\nprint("hello")\n',
  cpp: '// 自由模式 · C/C++（浏览器内真实编译）\n#include <stdio.h>\nint main(void) {\n  puts("hello");\n  return 0;\n}\n',
  shell: '# 自由模式 · Shell（container2wasm 真实 Linux 容器）\n# 可用：echo/cat/grep/sort/uniq/wc/head/tail/find 等\necho hello\n',
  java: '// 自由模式 · Java（teavm-javac）\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println("hello");\n  }\n}\n',
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

const testcaseSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  stdin: z.string().max(100_000),
  expected: z.string().max(100_000),
  mode: z.enum(["exact", "eol", "ws", "regex-line", "numeric-tol"]),
});

const draftSchema = z.object({
  code: z.string().max(200_000),
  stdin: z.string().max(100_000),
  testcases: z.array(testcaseSchema).max(50),
});

function langOrThrow(value: string): (typeof LANGS)[number] {
  if (!(LANGS as readonly string[]).includes(value)) throw new HttpError(400, "INVALID_LANG", `不支持的语言: ${value}`);
  return value as (typeof LANGS)[number];
}

freeformRoutes.get("/freeform", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT lang, code, stdin, testcases_json, updated_at FROM freeform_drafts WHERE user_id = ?1",
  ).bind(c.get("user").id).all<{
    lang: string; code: string; stdin: string; testcases_json: string; updated_at: string;
  }>();
  const drafts: Record<string, FreeformDraft> = {};
  for (const row of rows.results) {
    drafts[row.lang] = {
      lang: row.lang, code: row.code, stdin: row.stdin,
      testcases: JSON.parse(row.testcases_json) as FreeTestCase[],
      updated_at: row.updated_at,
    };
  }
  return c.json({ drafts, templates: FREE_TEMPLATES });
});

freeformRoutes.get("/freeform/:lang", async (c) => {
  const lang = langOrThrow(c.req.param("lang"));
  const row = await c.env.DB.prepare(
    "SELECT * FROM freeform_drafts WHERE user_id = ?1 AND lang = ?2",
  ).bind(c.get("user").id, lang).first<{
    code: string; stdin: string; testcases_json: string; updated_at: string;
  }>();
  return c.json({
    draft: row ? {
      lang, code: row.code, stdin: row.stdin,
      testcases: JSON.parse(row.testcases_json) as FreeTestCase[],
      updated_at: row.updated_at,
    } : {
      lang, code: FREE_TEMPLATES[lang], stdin: "",
      testcases: [{ id: "t1", name: "样例", stdin: "", expected: "hello\n", mode: "eol" }],
    },
  });
});

freeformRoutes.put("/freeform/:lang", async (c) => {
  const lang = langOrThrow(c.req.param("lang"));
  const body = await parseBody(c, draftSchema);
  const updatedAt = nowIso();
  await c.env.DB.prepare(`INSERT INTO freeform_drafts (user_id, lang, code, stdin, testcases_json, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, lang) DO UPDATE SET code = excluded.code, stdin = excluded.stdin,
      testcases_json = excluded.testcases_json, updated_at = excluded.updated_at`)
    .bind(c.get("user").id, lang, body.code, body.stdin, JSON.stringify(body.testcases), updatedAt).run();
  return c.json({ draft: { lang, ...body, updated_at: updatedAt } });
});
