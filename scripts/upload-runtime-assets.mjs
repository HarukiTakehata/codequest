#!/usr/bin/env node
// 上传 container2wasm 运行时工件到 R2（本地默认；传 --remote 上传线上）。
// 用法: node scripts/upload-runtime-assets.mjs [--remote]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--remote")) {
  console.error("用法: node scripts/upload-runtime-assets.mjs [--remote]");
  process.exit(1);
}
const remote = args.includes("--remote");
const runtimeDir = resolve(process.cwd(), "runtime");
const files = readdirSync(runtimeDir).filter((name) => /^cq-dev-.+\.wasm\.gz$/.test(name)).sort();
if (!files.length) {
  console.error("没有可上传的运行时工件；请先运行 c2w 转换并 gzip");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(resolve(runtimeDir, "container-environments.json"), "utf8"));
for (const name of files) {
  const file = resolve(runtimeDir, name);
  if (name.startsWith("cq-dev-")) {
    const id = name.slice("cq-dev-".length, -".wasm.gz".length);
    const item = manifest.find((entry) => entry.id === id);
    const bytes = readFileSync(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!item || item.bytes !== bytes.length || item.sha256 !== sha256) {
      console.error(`工件与清单不一致: ${name}；请重新运行 c2w 转换生成清单`);
      process.exit(1);
    }
  }
  const command = [
    "wrangler", "r2", "object", "put", `codequest-course-packs/runtime/${name}`,
    "--file", file,
    "--content-type", "application/wasm",
    ...(remote ? ["--remote"] : ["--local"]),
  ];
  console.log(`$ npx ${command.join(" ")}`);
  const result = spawnSync("npx", command, { stdio: "inherit", cwd: process.cwd() });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`运行时工件已上传: ${files.length} 个`);
