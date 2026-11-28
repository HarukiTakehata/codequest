import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error 该维护脚本是 JavaScript，不生成声明文件。
import { verifyWebBuild } from "../../scripts/verify-web-build.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(adminHtml: string, editorHtml = adminHtml.replaceAll("/admin/", "/editor/").replace('content="admin"', 'content="editor"')) {
  const root = await mkdtemp("/tmp/opencode/codequest-web-build-");
  roots.push(root);
  await Promise.all([
    mkdir(join(root, "admin/assets"), { recursive: true }),
    mkdir(join(root, "editor/assets"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "admin/index.html"), adminHtml),
    writeFile(join(root, "editor/index.html"), editorHtml),
  ]);
  return root;
}

const validHtml = `<!doctype html>
<meta name="codequest-app" content="admin">
<script type="module" src="/admin/assets/app.js"></script>
<link rel="stylesheet" href="/admin/assets/app.css">`;

async function writeAssets(root: string, app: "admin" | "editor") {
  await Promise.all([
    writeFile(join(root, app, "assets/app.js"), `console.log('${app}')`),
    writeFile(join(root, app, "assets/app.css"), "body{}"),
  ]);
}

describe("admin/editor 嵌入产物上传前校验", () => {
  it("HTML 引用的 JS/CSS 都存在时同时通过 admin 与 editor 校验", async () => {
    const root = await fixture(validHtml);
    await writeAssets(root, "admin");
    await writeAssets(root, "editor");
    const assets: Array<{ reference: string; bytes: number }> = await verifyWebBuild(root);
    expect(assets.map((asset) => asset.reference)).toEqual([
      "/admin/assets/app.js",
      "/admin/assets/app.css",
      "/editor/assets/app.js",
      "/editor/assets/app.css",
    ]);
    expect(assets.every((asset) => asset.bytes > 0)).toBe(true);
  });

  it("任一应用缺少 CSS 或 JS 时拒绝，避免部署出打不开的内嵌应用", async () => {
    for (const app of ["admin", "editor"] as const) {
      const missingCss = await fixture(validHtml);
      await writeAssets(missingCss, app === "admin" ? "editor" : "admin");
      await writeFile(join(missingCss, app, "assets/app.js"), "console.log('app')");
      await expect(verifyWebBuild(missingCss)).rejects.toThrow(`/${app}/assets/app.css`);

      const missingJs = await fixture(validHtml);
      await writeAssets(missingJs, app === "admin" ? "editor" : "admin");
      await writeFile(join(missingJs, app, "assets/app.css"), "body{}");
      await expect(verifyWebBuild(missingJs)).rejects.toThrow(`/${app}/assets/app.js`);
    }
  });

  it("拒绝根路径 /assets 引用和错误应用标记", async () => {
    for (const app of ["admin", "editor"] as const) {
      const wrongBase = await fixture(validHtml);
      await writeAssets(wrongBase, "admin");
      await writeAssets(wrongBase, "editor");
      const htmlPath = join(wrongBase, app, "index.html");
      const html = await readFile(htmlPath, "utf8");
      await writeFile(htmlPath, html.replaceAll(`/${app}/assets/`, "/assets/"));
      await expect(verifyWebBuild(wrongBase)).rejects.toThrow(`必须位于 /${app}/assets/`);

      const wrongApp = await fixture(validHtml);
      await writeAssets(wrongApp, "admin");
      await writeAssets(wrongApp, "editor");
      await writeFile(join(wrongApp, app, "index.html"), (await readFile(join(wrongApp, app, "index.html"), "utf8")).replace(`content="${app}"`, 'content="web"'));
      await expect(verifyWebBuild(wrongApp)).rejects.toThrow("不是");
    }
  });

  it("缺少 editor 嵌入目录时失败，不允许只校验 admin", async () => {
    const root = await fixture(validHtml);
    await writeAssets(root, "admin");
    await rm(join(root, "editor"), { recursive: true, force: true });
    await expect(verifyWebBuild(root)).rejects.toThrow();
  });

  it("Wrangler 在 deploy/dev 前执行完整构建、监听 editor，并让 Worker 先处理 /editor", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
    expect(config.build).toMatchObject({ command: "npm run build" });
    expect(config.build.watch_dir).toEqual(expect.arrayContaining([
      "./src", "./apps/web/src", "./apps/web/public", "./apps/admin/src", "./apps/admin/public",
      "./apps/editor/src", "./apps/editor/public", "./packages",
    ]));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(["/editor", "/editor/*"]));
  });

  it("根构建/typecheck 包含 editor，Vite 嵌入 base 与输出目录正确", async () => {
    const { readFileSync } = await import("node:fs");
    const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(rootPackage.scripts["dev:editor"]).toContain("@codequest/editor");
    expect(rootPackage.scripts["build:editor"]).toContain("@codequest/editor");
    expect(rootPackage.scripts["build:editor:embedded"]).toContain("@codequest/editor");
    expect(rootPackage.scripts.build).toContain("build:editor:embedded");
    expect(rootPackage.scripts.typecheck).toContain("@codequest/editor");

    const editorPackage = JSON.parse(readFileSync(new URL("../../apps/editor/package.json", import.meta.url), "utf8"));
    expect(editorPackage.scripts["build:embedded"]).toContain("VITE_EDITOR_BASE=/editor/");
    const viteConfig = readFileSync(new URL("../../apps/editor/vite.config.ts", import.meta.url), "utf8");
    expect(viteConfig).toContain('base: process.env.VITE_EDITOR_BASE || "/"');
    expect(viteConfig).toContain('"../../apps/web/dist/editor"');
    expect(readFileSync(new URL("../../apps/editor/index.html", import.meta.url), "utf8")).toContain('name="codequest-app" content="editor"');
  });

  it("静态资源排除开发文件与嵌套元文件，admin/editor 资源安全头保持可用", async () => {
    const { readFileSync } = await import("node:fs");
    const ignore = readFileSync(new URL("../../apps/web/public/.assetsignore", import.meta.url), "utf8");
    expect(ignore).toContain("**/*.map");
    expect(ignore).toContain("**/*.d.ts");
    expect(ignore).toContain("**/*.tsbuildinfo");
    expect(ignore).toContain("admin/_headers");
    expect(ignore).toContain("admin/_redirects");
    expect(ignore).toContain("editor/_headers");
    expect(ignore).toContain("editor/_redirects");

    const headers = readFileSync(new URL("../../apps/web/public/_headers", import.meta.url), "utf8");
    expect(headers).toContain("/admin/assets/*");
    expect(headers).toContain("/editor/assets/*");
    expect(headers).toContain("Cache-Control: public, max-age=31536000, immutable");
    expect(headers).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=()");
  });
});
