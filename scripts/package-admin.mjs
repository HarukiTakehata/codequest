#!/usr/bin/env node
// 将管理面板 Vite 产物同步到设计书 §7.3 的 nginx 发布目录。
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/admin/dist");
const destination = resolve(root, "deploy/admin");

if (!existsSync(resolve(source, "index.html"))) {
  console.error("未找到 apps/admin/dist/index.html，请先运行管理面板构建。");
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log(`管理面板产物已同步到 ${destination}`);
