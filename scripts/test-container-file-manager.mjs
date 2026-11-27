#!/usr/bin/env node
// 真实 c2w 浏览器验收：可见命令、双向文件同步、Material 树状管理器与前台进程保护。
// 用法: C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-container-file-manager.mjs
import http from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { loadC2wBrowserWorkerAssets } from "./c2w-browser-assets.mjs";

const browserBin = process.env.C2W_BROWSER ?? "/opt/microsoft/msedge/msedge";
const timeoutMs = Number(process.env.C2W_FILE_TEST_TIMEOUT_MS ?? 180_000);
const port = Number(process.env.C2W_FILE_TEST_PORT ?? 8945);
const tmp = "/tmp/opencode/c2w-file-manager-test";
mkdirSync(tmp, { recursive: true });

await build({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import { ContainerShell } from "./apps/web/src/components/ContainerShell.tsx";
      import { I18nProvider } from "./apps/web/src/i18n/I18nProvider.tsx";
      import { ThemeProvider } from "./apps/web/src/theme/ThemeProvider.tsx";
      createRoot(document.getElementById("root")).render(
        React.createElement(I18nProvider, null,
          React.createElement(ThemeProvider, null,
            React.createElement(ContainerShell, { onBack: () => {} }),
          ),
        ),
      );`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: `${tmp}/runner.mjs`,
});
const runner = await readFile(`${tmp}/runner.mjs`);
const cssPath = `${tmp}/runner.css`;
const css = existsSync(cssPath) ? await readFile(cssPath) : Buffer.alloc(0);
const runtimeFile = resolve("runtime/cq-dev-shell.wasm.gz");
const runtimeBytes = statSync(runtimeFile).size;
const assets = await loadC2wBrowserWorkerAssets(process.cwd(), { totalBytes: runtimeBytes });
const manifest = await readFile(resolve("apps/web/public/container-environments.json"));
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/runner.css"></head><body><div id="root"></div></body><script type="module" src="/runner.mjs"></script></html>`;
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const runtimeRequests = [];
const iconRequests = [];
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }); res.end(html); return; }
  if (url === "/runner.mjs") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(runner); return; }
  if (url === "/runner.css") { res.writeHead(200, { ...headers, "Content-Type": "text/css" }); res.end(css); return; }
  if (url === "/container-environments.json") { res.writeHead(200, { ...headers, "Content-Type": "application/json" }); res.end(manifest); return; }
  if (url === "/vm-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(assets.vmWorker); return; }
  if (url === "/ring-buffer-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(assets.ringWorker); return; }
  const vendor = assets.vendorFiles.get(url);
  if (vendor) { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vendor); return; }
  if (url.startsWith("/vendor/material-icon-theme/")) {
    iconRequests.push(url);
    res.writeHead(200, { ...headers, "Content-Type": url.endsWith(".svg") ? "image/svg+xml" : "application/json" });
    createReadStream(resolve(`apps/web/public${url}`)).pipe(res);
    return;
  }
  if (url === "/runtime/cq-dev-shell.wasm") {
    runtimeRequests.push(req.url);
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm", "Content-Length": runtimeBytes });
    createReadStream(runtimeFile).pipe(res);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((ready) => server.listen(port, "127.0.0.1", ready));

const browser = await chromium.launch({
  executablePath: browserBin,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions"],
});
const context = await browser.newContext({ acceptDownloads: true, locale: "en-US", viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
const report = async (stage, data = {}) => console.log(`EVENT ${stage} ${JSON.stringify(data)}`);

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  const panel = page.locator(".container-file-manager");
  const terminalText = async () => page.locator(".xterm-rows").textContent();
  const terminalSamples = [];
  const sampleTerminal = async (label) => {
    const text = await terminalText();
    terminalSamples.push({ label, text });
    return text;
  };
  const waitIdle = async (label) => {
    await report(label);
    await page.waitForFunction(() => {
      const panel = document.querySelector(".container-file-manager");
      return panel?.getAttribute("data-ready") === "true" && panel?.getAttribute("data-idle") === "true" && panel?.getAttribute("data-busy") === "false" && panel?.getAttribute("data-loaded") === "true";
    }, undefined, { timeout: 30_000 });
    const alert = await panel.locator(".file-manager-alert").textContent().catch(() => "");
    if (alert) throw new Error(`${label}: ${alert}`);
  };
  const row = (name) => panel.locator(".file-tree-row").filter({ hasText: name }).first();
  const create = async (kind, name) => {
    await panel.locator(`button[aria-label="${kind}"]`).click();
    await panel.locator(".file-dialog input").fill(name);
    await panel.locator(".file-dialog button[type=submit]").click();
    await waitIdle(`created ${name}`);
  };
  const remove = async (name) => {
    const target = row(name);
    await target.hover();
    await target.locator('button[aria-label="Delete"]').click();
    await panel.locator(".file-dialog button[type=submit]").click();
    await waitIdle(`deleted ${name}`);
  };
  const typeCommand = async (command) => {
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");
  };

  await waitIdle("initial tree");
  await sampleTerminal("initial ls");
  const initialRoot = await panel.getAttribute("data-root");
  const initialCols = await page.locator(".xterm-host").getAttribute("data-terminal-cols");

  await create("New folder", "docs");
  await sampleTerminal("mkdir docs");
  await page.waitForFunction(() => [...document.querySelectorAll(".file-tree-row")].some((item) => item.getAttribute("aria-expanded") === "true" && item.textContent.includes("docs")));
  await create("New file", "notes.txt");
  await sampleTerminal("create notes");
  await row("notes.txt").locator(".file-tree-main").click();
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.locator(".file-editor").fill("hello c2w\nsecond line\n");
  await panel.getByRole("button", { name: "Save to container", exact: true }).click();
  await waitIdle("saved text");
  await sampleTerminal("save notes");

  await typeCommand("cat docs/notes.txt");
  await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent.includes("second line"), undefined, { timeout: 20_000 });
  await waitIdle("terminal cat synced");
  await sampleTerminal("terminal cat");

  // Terminal -> manager: cd changes the root, touch adds a visible tree row.
  await typeCommand("cd /tmp");
  await page.waitForFunction(() => document.querySelector(".container-file-manager")?.getAttribute("data-root") === "/tmp", undefined, { timeout: 30_000 });
  await waitIdle("terminal cd synced");
  await sampleTerminal("terminal cd");
  await typeCommand("touch from-terminal.txt");
  await row("from-terminal.txt").waitFor({ state: "visible", timeout: 30_000 });
  await waitIdle("terminal touch synced");
  await sampleTerminal("terminal touch");

  const createdByTerminal = row("from-terminal.txt");
  await createdByTerminal.hover();
  await createdByTerminal.locator('button[aria-label="Rename"]').click();
  await panel.locator(".file-dialog input").fill("terminal-created.txt");
  await panel.locator(".file-dialog button[type=submit]").click();
  await waitIdle("renamed terminal file");
  await remove("terminal-created.txt");
  await typeCommand("cd /home/student");
  await page.waitForFunction(() => document.querySelector(".container-file-manager")?.getAttribute("data-root") === "/home/student", undefined, { timeout: 30_000 });
  await waitIdle("returned home");
  await row("docs").locator(".file-tree-main").click();
  await row("notes.txt").waitFor({ state: "visible", timeout: 30_000 });
  await waitIdle("reopened docs");

  const notes = row("notes.txt");
  await notes.hover();
  await notes.locator('button[aria-label="Rename"]').click();
  await panel.locator(".file-dialog input").fill("renamed.txt");
  await panel.locator(".file-dialog button[type=submit]").click();
  await waitIdle("renamed manager file");
  await remove("renamed.txt");
  await remove("docs");

  // A foreground process must receive no injected file command.
  await typeCommand("sleep 30");
  await page.waitForFunction(() => document.querySelector(".container-file-manager")?.getAttribute("data-idle") === "false", undefined, { timeout: 10_000 });
  const sleepBaseline = await terminalText();
  const refreshDisabled = await panel.locator('button[aria-label="Refresh files"]').isDisabled();
  const duringSleep = await terminalText();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+c");
  await page.waitForFunction(() => document.querySelector(".container-file-manager")?.getAttribute("data-idle") === "true", undefined, { timeout: 30_000 });
  await waitIdle("foreground interrupted");

  await page.locator(".page-toolbar").getByRole("button", { name: "Hide file manager", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  const hiddenCols = await page.locator(".xterm-host").getAttribute("data-terminal-cols");
  await page.locator(".page-toolbar").getByRole("button", { name: "Show file manager", exact: true }).click();
  await panel.waitFor({ state: "visible" });
  await waitIdle("reopened tree");

  const materialLoaded = await panel.locator(".material-file-icon").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0));
  const finalTerminal = await terminalText();
  const visibleCommands = terminalSamples.map((sample) => sample.text).join("\n");
  const result = {
    initialRoot,
    terminalSamples,
    duringSleep,
    sleepBaseline,
    refreshDisabled,
    finalTerminal,
    runtimeRequests: runtimeRequests.length,
    iconRequests,
    materialLoaded,
    pageErrors,
    fixedTerminalCols: initialCols === hiddenCols,
  };
  const checks = {
    realC2wRoot: initialRoot === "/home/student",
    managerCommandsVisible: visibleCommands.includes("mkdir") && visibleCommands.includes("printf") && visibleCommands.includes("ls -la") && visibleCommands.includes("hello c2w"),
    compactCommands: visibleCommands.includes("pwd -P && busybox ls -la -- .") && !visibleCommands.includes("/bin/sh -c") && !visibleCommands.includes("CQ_FILE_CODE") && !visibleCommands.includes("__CQ_COMMAND_"),
    terminalCommandsVisible: visibleCommands.includes("cat docs/notes.txt") && visibleCommands.includes("cd /tmp") && visibleCommands.includes("touch from-terminal.txt"),
    terminalToManager: true,
    managerToTerminal: visibleCommands.includes("hello c2w") && visibleCommands.includes("second line"),
    foregroundProtected: refreshDisabled && duringSleep === sleepBaseline,
    materialIconsLocal: materialLoaded && iconRequests.some((url) => url.includes("material-icon-theme/icons/")),
    singleRuntime: runtimeRequests.length === 1,
    noEchoHacks: !visibleCommands.includes("stty -echo") && !visibleCommands.includes("PS1="),
    noPageErrors: pageErrors.length === 0,
    terminalSizeUnchanged: initialCols === hiddenCols,
  };
  await writeFile("docs/container-file-manager-result.json", JSON.stringify({ ok: Object.values(checks).every(Boolean), checks, result, browser: browserBin, at: new Date().toISOString() }, null, 2) + "\n");
  console.log("CHECKS " + JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
} catch (error) {
  const terminal = await page.locator(".xterm-rows").textContent().catch(() => "");
  const panelText = await page.locator(".container-file-manager").textContent().catch(() => "");
  await writeFile("docs/container-file-manager-result.json", JSON.stringify({ ok: false, error: String(error), stack: String(error?.stack ?? error), terminal, panelText, pageErrors, browser: browserBin, at: new Date().toISOString() }, null, 2) + "\n");
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
