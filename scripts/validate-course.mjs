#!/usr/bin/env node
// 课程包验收脚本（沿用 home 仓库 validation/ 惯例）：第三人按文档产出包后可自测。
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "courses/demo");
const errors = [];
const files = {};
function walk(current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) walk(full);
    else files[relative(dir, full).replace(/\\/g, "/")] = readFileSync(full, "utf8");
  }
}
if (!existsSync(dir)) { console.error(`目录不存在: ${dir}`); process.exit(1); }
walk(dir);

const readJson = (path) => {
  try { return JSON.parse(files[path]); } catch { errors.push(`${path}: JSON 无法解析`); return null; }
};

const meta = readJson("course.json");
if (meta) {
  for (const key of ["id", "slug", "title", "entry"]) {
    if (typeof meta[key] !== "string" || !meta[key]) errors.push(`course.json: 缺少 ${key}`);
  }
  if (meta.entry && !files[meta.entry]) errors.push(`course.json: 入口剧本 ${meta.entry} 不存在`);
  if (meta.entry && !/.*\.txt$/.test(meta.entry)) errors.push("入口必须是 .txt 剧本");
}
if (!files["start.txt"]) errors.push("缺少 start.txt（WebGAL 惯例入口）");

const challengeIds = new Set();
for (const [path, text] of Object.entries(files)) {
  if (!path.startsWith("challenges/") || !path.endsWith(".json")) continue;
  let challenge;
  try { challenge = JSON.parse(text); } catch { errors.push(`${path}: JSON 无法解析`); continue; }
  for (const key of ["id", "title", "lang"]) {
    if (!challenge[key]) errors.push(`${path}: 缺少 ${key}`);
  }
  if (!["javascript", "python", "cpp", "shell"].includes(challenge.lang)) {
    errors.push(`${path}: 不支持的语言 ${challenge.lang}`);
  }
  if (challengeIds.has(challenge.id)) errors.push(`${path}: 挑战 id 重复 ${challenge.id}`);
  challengeIds.add(challenge.id);
  if (challenge.judge && !files[`judges/${challenge.judge}.json`]) {
    errors.push(`${path}: 判题配置 ${challenge.judge} 不存在`);
  }
  for (const goal of challenge.goals ?? []) {
    if (!goal.id || !goal.text || !goal.check?.kind) errors.push(`${path}: goal 字段不完整`);
  }
}
for (const [path, text] of Object.entries(files)) {
  if (!path.startsWith("judges/") || !path.endsWith(".json")) continue;
  let judge;
  try { judge = JSON.parse(text); } catch { errors.push(`${path}: JSON 无法解析`); continue; }
  if (!Array.isArray(judge.cases) || judge.cases.length === 0) errors.push(`${path}: 至少需要一个测试点`);
  for (const test of judge.cases ?? []) {
    for (const key of ["id", "name", "stdin", "expected"]) {
      if (typeof test[key] !== "string") errors.push(`${path}: 测试点缺少 ${key}`);
    }
    if (test.mode && !["exact", "eol", "ws", "regex-line", "numeric-tol"].includes(test.mode)) {
      errors.push(`${path}: 未知比对模式 ${test.mode}`);
    }
  }
}

// 剧本中的 code/term 指令必须绑定到真实挑战。
const script = Object.entries(files).filter(([p]) => p.endsWith(".txt")).map(([, v]) => v).join("\n");
for (const match of script.matchAll(/\b(?:code|term):([\w-]+)/g)) {
  if (!challengeIds.has(match[1])) errors.push(`剧本引用了不存在的挑战: ${match[1]}`);
}

if (errors.length) {
  console.error(`❌ ${dir}: ${errors.length} 个问题`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✅ ${dir}: ${Object.keys(files).length} 个文件，${challengeIds.size} 个挑战，校验通过`);
