#!/usr/bin/env node
// 生产构建浏览器回归：DECRQM 终端查询与真实 c2w 容器内的 vim 编辑。
// 先运行 npm run build:web；可用 C2W_BROWSER 指定 Chromium/Edge。
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { delimiter, extname, resolve, sep } from "node:path";
import { chromium } from "playwright-core";

const browserArg = process.env.C2W_BROWSER
  ?? ["/opt/microsoft/msedge/msedge", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((candidate) => existsSync(candidate));
if (!browserArg) throw new Error("请用 C2W_BROWSER 指定 Chromium/Edge 可执行文件");
const browserBin = [browserArg, ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => resolve(dir, browserArg))]
  .find((candidate) => existsSync(candidate)) ?? browserArg;
if (!existsSync(browserBin)) throw new Error(`浏览器不存在：${browserArg}`);

const root = resolve("apps/web/dist");
if (!existsSync(resolve(root, "index.html"))) throw new Error("请先运行 npm run build:web");
const runtime = resolve("runtime/cq-dev-shell.wasm.gz");
const timeoutMs = Number(process.env.C2W_TERMINAL_TEST_TIMEOUT_MS ?? 120_000);
const port = Number(process.env.C2W_TERMINAL_TEST_PORT ?? 8945);
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (pathname === "/runtime/cq-dev-shell.wasm") {
    // 与 R2 路由一致：传输 gzip 字节但不声明 Content-Encoding，由 Worker 解压。
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm", "Content-Length": statSync(runtime).size });
    createReadStream(runtime).pipe(res);
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403); res.end(); return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { ...headers, "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((ready) => server.listen(port, "127.0.0.1", ready));

let browser;
let page;
const pageErrors = [];
const consoleErrors = [];
const failedResponses = [];
const requests = [];
try {
  browser = await chromium.launch({
    executablePath: browserBin,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/v1/setup/status"
      ? { needs_setup: false, instance_name: "CodeQuest" }
      : path === "/api/v1/me"
        ? { user: { id: "terminal-test", email: "terminal@example.test", display_name: "Terminal Test", role: "admin", must_change_password: false } }
        : path === "/api/v1/courses"
          ? { courses: [] }
          : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".mode-card-terminal").click();
  await page.waitForFunction(() => {
    const lines = (document.querySelector(".xterm-screen")?.innerText ?? "").split("\n").filter((line) => line.trim());
    return lines.at(-1)?.startsWith("$ ");
  }, null, { timeout: timeoutMs });
  const textarea = page.locator(".xterm-helper-textarea");
  await textarea.focus();

  await page.keyboard.type("stty size; echo CQ_SIZE_'DONE'");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".xterm-screen")?.textContent?.includes("CQ_SIZE_DONE"), null, { timeout: 10_000 });
  const sizeOutput = await page.locator(".xterm-screen").innerText();
  const grid = await page.evaluate(() => {
    const host = document.querySelector(".xterm-host");
    return { cols: Number(host?.dataset.terminalCols), rows: Number(host?.dataset.terminalRows) };
  });
  const sizeMatch = grid.cols > 0 && grid.rows > 0
    && new RegExp(`(^|\\n)${grid.rows} ${grid.cols}(?:\\r?\\n|$)`).test(sizeOutput);

  // vim 启动会发送 DECRQM。让容器输出查询，再由 xterm 回复到 stdin，用 read 捕获响应字节。
  await page.keyboard.type("echo CQ_DECRQM_'READY'; stty -echo; printf '\\033[?2026$p'; echo CQ_QUERY_'SENT'; IFS= read -r reply; stty echo; printf '%s' \"$reply\" | od -An -tx1; echo CQ_DECRQM_'DONE'");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".xterm-screen")?.textContent?.includes("CQ_QUERY_SENT"), null, { timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".xterm-screen")?.textContent?.includes("CQ_DECRQM_DONE"), null, { timeout: 10_000 });
  const decrqmOutput = (await page.locator(".xterm-screen").innerText()).replace(/\s+/g, " ");
  const decrqmReply = /\b1b 5b 3f 32 30 32 36 3b [0-4][0-9a-f] 24 79\b/.test(decrqmOutput);
  await page.waitForFunction(() => {
    const lines = (document.querySelector(".xterm-screen")?.innerText ?? "").split("\n").filter((line) => line.trim());
    return lines.at(-1)?.startsWith("$ ");
  }, null, { timeout: 10_000 });

  // 真实 BusyBox vim：新建文件、插入、保存退出，再读回内容。
  await page.keyboard.type("vim cq-vim-test.txt");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".xterm-screen")?.textContent?.includes('"cq-vim-test.txt"'), null, { timeout: 10_000 });
  await page.keyboard.type("iCQ_VIM_OK");
  await page.waitForFunction(() => document.querySelector(".xterm-screen")?.textContent?.includes("-- INSERT --"), null, { timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".xterm-screen")?.textContent?.includes("-- INSERT --"), null, { timeout: 10_000 });
  await page.keyboard.type(":wq");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const lines = (document.querySelector(".xterm-screen")?.innerText ?? "").split("\n").filter((line) => line.trim());
    return lines.at(-1)?.startsWith("$ ");
  }, null, { timeout: 10_000 });
  await page.keyboard.type("cat cq-vim-test.txt; echo CQ_VIM_'DONE'");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".xterm-screen")?.textContent?.includes("CQ_VIM_DONE"), null, { timeout: 10_000 });
  const terminalOutput = await page.locator(".xterm-screen").innerText();
  const vimRoundTrip = terminalOutput.includes("CQ_VIM_OK");

  const checks = { sizeMatch, decrqmReply, vimRoundTrip, noPageErrors: pageErrors.length === 0 };
  const report = { ok: Object.values(checks).every(Boolean), checks, grid, sizeOutput: sizeOutput.slice(-400), decrqmOutput: decrqmOutput.slice(-1200), terminalOutput: terminalOutput.slice(-1200), pageErrors, browser: browserBin, at: new Date().toISOString() };
  await writeFile("docs/terminal-vim-result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  const diagnostic = {
    ok: false,
    error: String(error?.stack ?? error),
    pageErrors,
    consoleErrors,
    failedResponses,
    requests,
    terminal: await page?.locator(".xterm-screen").innerText().catch(() => "") ?? "",
    progress: await page?.locator(".container-startup-progress").innerText().catch(() => "") ?? "",
    browser: browserBin,
    at: new Date().toISOString(),
  };
  await writeFile("docs/terminal-vim-result.json", JSON.stringify(diagnostic, null, 2) + "\n");
  console.log(JSON.stringify(diagnostic, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise((closed) => server.close(closed));
}
