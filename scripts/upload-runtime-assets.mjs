#!/usr/bin/env node
// 上传 container2wasm 运行时工件到 R2（本地默认；传 --remote 上传线上）。
// 用法: node scripts/upload-runtime-assets.mjs [--remote]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const file = resolve(process.cwd(), "runtime/cq-minimal.wasm.gz");
if (!existsSync(file)) {
  console.error(`缺少工件: ${file}（请先运行 c2w 转换并 gzip）`);
  process.exit(1);
}
const command = [
  "wrangler", "r2", "object", "put", "codequest-course-packs/runtime/cq-minimal.wasm.gz",
  "--file", file,
  "--content-type", "application/wasm",
  "--content-encoding", "gzip",
  ...(remote ? ["--remote"] : ["--local"]),
];
console.log(`$ npx ${command.join(" ")}`);
const result = spawnSync("npx", command, { stdio: "inherit", cwd: process.cwd() });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("运行时工件已上传");
