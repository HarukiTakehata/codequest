#!/usr/bin/env node
// 重置本地 D1 数据库（仅本地，绝不碰远端）：删除 wrangler local D1 状态后重放 migrations。
// 用法:
//   node scripts/reset-local-db.mjs                 # 需交互确认
//   node scripts/reset-local-db.mjs --yes           # 非交互确认
//   node scripts/reset-local-db.mjs --yes --persist-to /tmp/wrangler-fresh
import { rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const persistIndex = args.indexOf("--persist-to");
const persistTo = persistIndex >= 0 ? args[persistIndex + 1] : undefined;
if (persistIndex >= 0 && !persistTo) {
  console.error("--persist-to 需要一个目录参数");
  process.exit(1);
}
const base = persistTo ? resolve(persistTo) : resolve(process.cwd(), ".wrangler");
// wrangler 默认用 .wrangler/state/v3/d1；显式 --persist-to 时直接用 <dir>/v3/d1。
const d1Dir = resolve(base, persistTo ? "v3/d1" : "state/v3/d1");

if (!yes) {
  process.stdout.write(`将删除本地 D1 目录：${d1Dir}\n确认？[y/N] `);
  const answer = await new Promise((r) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => r(String(data).trim().toLowerCase()));
  });
  if (answer !== "y" && answer !== "yes") { console.log("已取消"); process.exit(0); }
}

if (existsSync(d1Dir)) {
  rmSync(d1Dir, { recursive: true, force: true });
  console.log(`已删除 ${d1Dir}`);
} else {
  console.log(`本地 D1 目录不存在，跳过删除: ${d1Dir}`);
}

const command = [
  "wrangler", "d1", "migrations", "apply", "codequest_local", "--local",
  ...(persistTo ? ["--persist-to", base] : []),
];
console.log(`执行: npx ${command.join(" ")}`);
const result = spawnSync("npx", command, { stdio: "inherit", cwd: process.cwd() });
if (result.status !== 0) {
  console.error("迁移失败，请检查 wrangler 配置");
  process.exit(result.status ?? 1);
}
console.log("本地数据库已重置，迁移已应用完毕");
