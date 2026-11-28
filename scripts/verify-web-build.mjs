#!/usr/bin/env node
// Fail before deployment when embedded admin/editor HTML references missing assets.
import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function inside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

async function verifyEmbeddedApp(root, app) {
  const label = app === "admin" ? "管理面板" : "地图编辑器";
  const htmlPath = resolve(root, `${app}/index.html`);
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes(`name="codequest-app" content="${app}"`)) {
    throw new Error(`apps/web/dist/${app}/index.html 不是${label}产物`);
  }

  const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith("/") && /\.(?:js|css)(?:[?#]|$)/.test(value));
  if (references.length === 0) throw new Error(`${label} HTML 未引用任何 /${app} 资源`);

  const checked = [];
  for (const reference of references) {
    if (!reference.startsWith(`/${app}/assets/`)) {
      throw new Error(`${label}资源必须位于 /${app}/assets/：${reference}`);
    }
    const relative = reference.slice(1);
    const target = resolve(root, relative);
    if (!inside(root, target)) throw new Error(`${label}资源路径逃逸：${reference}`);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`${label}资源缺失：${reference}`);
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label}资源不是普通文件：${reference}`);
    checked.push({ reference, bytes: info.size });
  }

  if (!checked.some((item) => item.reference.endsWith(".js"))) {
    throw new Error(`${label} HTML 缺少 JS 引用`);
  }
  if (!checked.some((item) => item.reference.endsWith(".css"))) {
    throw new Error(`${label} HTML 缺少 CSS 引用`);
  }
  return checked;
}

export async function verifyWebBuild(distRoot = resolve(repositoryRoot, "apps/web/dist")) {
  const root = resolve(distRoot);
  const [admin, editor] = await Promise.all([
    verifyEmbeddedApp(root, "admin"),
    verifyEmbeddedApp(root, "editor"),
  ]);
  return [...admin, ...editor];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyWebBuild().then(
    (assets) => console.log(`内嵌应用构建校验通过：admin/editor 共 ${assets.length} 个 HTML 引用资源存在。`),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
