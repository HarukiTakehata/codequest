#!/usr/bin/env node
// 课程创作期产物 → 管理端可上传的 JSON 包（设计 §4.1 内容即数据）。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const [dirArg, outArg] = process.argv.slice(2);
if (!dirArg) {
  console.error("用法: node scripts/pack-course.mjs <课程目录> [输出文件]");
  process.exit(1);
}
const root = resolve(dirArg);
const pack = {};
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) pack[relative(root, full).replace(/\\/g, "/")] = readFileSync(full, "utf8");
  }
}
walk(root);
const json = JSON.stringify(pack, null, 2);
if (outArg) { writeFileSync(outArg, json); console.error(`已打包 ${Object.keys(pack).length} 个文件 → ${outArg}`); }
else process.stdout.write(json + "\n");
