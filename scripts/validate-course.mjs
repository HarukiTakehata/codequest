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
  if (!["javascript", "python", "cpp", "shell", "java"].includes(challenge.lang)) {
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
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const judgeIds = new Set();
const judgeConfigs = new Map();
for (const [path, text] of Object.entries(files)) {
  if (!path.startsWith("judges/") || !path.endsWith(".json")) continue;
  let judge;
  try { judge = JSON.parse(text); } catch { errors.push(`${path}: JSON 无法解析`); continue; }
  if (!isRecord(judge)) { errors.push(`${path}: judge 必须是对象`); continue; }
  if (!judge.id) errors.push(`${path}: 缺少 id`);
  if (judgeIds.has(judge.id)) errors.push(`${path}: 判题 id 重复 ${judge.id}`);
  judgeIds.add(judge.id);
  if (judge.id) judgeConfigs.set(judge.id, judge);
  if (!Array.isArray(judge.cases) || judge.cases.length === 0) errors.push(`${path}: 至少需要一个测试点`);
  const kind = judge.kind ?? "oi";
  if (!["oi", "script"].includes(kind)) errors.push(`${path}: 未知判题类型 ${kind}`);
  const caseIds = new Set();
  for (const test of judge.cases ?? []) {
    if (!isRecord(test)) { errors.push(`${path}: 测试点必须是对象`); continue; }
    if (!test.id || !test.name) errors.push(`${path}: 测试点缺少 id/name`);
    if (caseIds.has(test.id)) errors.push(`${path}: 测试点 id 重复 ${test.id}`);
    caseIds.add(test.id);
    if (test.weight !== undefined && (!Number.isFinite(test.weight) || test.weight <= 0)) {
      errors.push(`${path}: weight 必须是正数`);
    }
    if (kind === "oi") {
      for (const key of ["stdin", "expected"]) {
        if (typeof test[key] !== "string") errors.push(`${path}: 测试点缺少 ${key}`);
      }
      if (test.mode && !["exact", "eol", "ws", "regex-line", "numeric-tol"].includes(test.mode)) {
        errors.push(`${path}: 未知比对模式 ${test.mode}`);
      }
    } else {
      if (!isRecord(test.expect) || Object.keys(test.expect).length === 0) {
        errors.push(`${path}: 脚本测试点 expect 必须是非空对象`);
      }
      if ("stdin" in test || "expected" in test || "mode" in test) {
        errors.push(`${path}: 脚本测试点不能使用 OI 的 stdin/expected/mode 字段`);
      }
      const runs = [test.call, test.fire, test.emit].filter((value) => value !== undefined);
      if (runs.length !== 1) errors.push(`${path}: 脚本测试点必须且只能指定 call/fire/emit 之一`);
      if (test.call !== undefined && (typeof test.call?.fn !== "string" || !test.call.fn)) {
        errors.push(`${path}: call.fn 不能为空`);
      }
      if (test.fire !== undefined && (typeof test.fire !== "string" || !test.fire)) {
        errors.push(`${path}: fire 不能为空`);
      }
      if (test.emit !== undefined && (typeof test.emit?.signal !== "string" || !test.emit.signal)) {
        errors.push(`${path}: emit.signal 不能为空`);
      }
      if (test.world !== undefined && !isRecord(test.world)) errors.push(`${path}: world 必须是对象`);
      if (test.dice !== undefined && (!Array.isArray(test.dice) || test.dice.some((n) => !Number.isFinite(n)))) {
        errors.push(`${path}: dice 必须是数字数组`);
      }
      if (test.choices !== undefined && (!Array.isArray(test.choices) || test.choices.some((n) => !Number.isInteger(n)))) {
        errors.push(`${path}: choices 必须是整数数组`);
      }
    }
  }
  if (kind === "script") {
    if (judge.init !== undefined && !isRecord(judge.init)) errors.push(`${path}: init 必须是对象`);
    if (judge.requiredExports !== undefined && (!Array.isArray(judge.requiredExports) || judge.requiredExports.some((name) => typeof name !== "string" || !name))) {
      errors.push(`${path}: requiredExports 必须是非空字符串数组`);
    }
    for (const [key, value] of Object.entries(judge.limits ?? {})) {
      if (!Number.isInteger(value) || value <= 0) errors.push(`${path}: limits.${key} 必须是正整数`);
    }
  }
}
for (const path of Object.keys(files).filter((p) => p.startsWith("challenges/") && p.endsWith(".json"))) {
  let challenge;
  try { challenge = JSON.parse(files[path]); } catch { continue; }
  if (!challenge.judge) continue;
  const judge = judgeConfigs.get(challenge.judge);
  if (judge && (judge.kind ?? "oi") === "script" && (challenge.lang !== "javascript" || (challenge.mode ?? "code") !== "code")) {
    errors.push(`${path}: 脚本判题要求 lang=javascript、mode=code`);
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
