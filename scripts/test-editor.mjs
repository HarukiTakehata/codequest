#!/usr/bin/env node
// M6d 最小地图编辑器 Chromium 验收：直接加载 /editor/ 嵌入产物。
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "apps/web/dist");
const editorIndex = resolve(dist, "editor/index.html");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

try {
  assert((await stat(editorIndex)).isFile(), "缺少 apps/web/dist/editor/index.html");
} catch (error) {
  console.error("请先运行 npm run build:editor:embedded。", error instanceof Error ? error.message : error);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/editor") {
      res.writeHead(302, { Location: "/editor/" }).end();
      return;
    }
    if (!pathname.startsWith("/editor/")) {
      res.writeHead(404).end("not found");
      return;
    }
    const relative = pathname.slice("/editor/".length);
    const candidate = resolve(dist, "editor", relative || "index.html");
    if (!candidate.startsWith(`${resolve(dist, "editor")}/`)) {
      res.writeHead(403).end();
      return;
    }
    let file = candidate;
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      if (extname(pathname)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("editor asset missing");
        return;
      }
      file = editorIndex;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Cache-Control": file.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    }).end(body);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(String(error));
  }
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.C2W_BROWSER ?? process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await page.goto(`${origin}/editor/`);
  const canvas = page.getByTestId("map-canvas");
  await canvas.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.title === "CodeQuest · RPGJS 地图编辑器");
  assert.equal(await canvas.getAttribute("width"), "640");
  assert.equal(await canvas.getAttribute("height"), "480");

  async function clickCell(x, y) {
    const box = await canvas.boundingBox();
    assert(box, "map canvas has no bounding box");
    await page.mouse.click(box.x + x * 32 + 16, box.y + y * 32 + 16);
  }

  async function exportMap() {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-map").click(),
    ]);
    const path = await download.path();
    assert(path, "download has no local path");
    return JSON.parse(await readFile(path, "utf8"));
  }

  await page.getByTestId("tile-2").click();
  await clickCell(5, 5);
  let document = await exportMap();
  assert.equal(document.width, 20);
  assert.equal(document.height, 15);
  assert.equal(document.layers[0].data[5 * 20 + 5], 2);

  await page.getByTestId("layer-collision").click();
  await clickCell(6, 5);
  await page.getByTestId("layer-events").click();
  await clickCell(7, 5);
  await page.locator("#event-id").fill("npc-e2e");
  await page.locator("#event-name").fill("E2E Guide");
  await page.locator("#event-x").fill("8");
  await page.locator("#event-y").fill("6");
  await page.getByTestId("save-event").click();

  document = await exportMap();
  assert.equal(document.layers[1].data[5 * 20 + 6], 1);
  assert.equal(document.layers[2].objects.length, 3);
  const event = document.layers[2].objects.find((object) => object.properties.some((property) => property.name === "eventId" && property.value === "npc-e2e"));
  assert(event, "edited event missing from export");
  assert.equal(event.name, "E2E Guide");
  assert.equal(event.x, 8 * 32);
  assert.equal(event.y, 6 * 32);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("codequest-rpgjs-map-v1")));
  assert.equal(saved.tiles[5 * 20 + 5], 2);
  assert.equal(saved.collision[5 * 20 + 6], 1);
  assert(saved.events.some((item) => item.id === "npc-e2e"));

  await page.reload();
  await canvas.waitFor({ state: "visible" });
  document = await exportMap();
  assert.equal(document.layers[0].data[5 * 20 + 5], 2);
  assert.equal(document.layers[1].data[5 * 20 + 6], 1);
  assert(document.layers[2].objects.some((object) => object.properties.some((property) => property.name === "eventId" && property.value === "npc-e2e")));

  const languageToggle = page.getByTestId("language-switcher");
  assert.equal(await languageToggle.locator("svg").count(), 1);
  assert(!(await languageToggle.innerText()).includes("中文"));
  await languageToggle.click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.getByRole("heading", { name: "CodeQuest · RPGJS Map Editor" }).waitFor();
  await page.waitForFunction(() => document.title === "CodeQuest · RPGJS Map Editor");
  await languageToggle.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await languageToggle.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await languageToggle.getAttribute("aria-expanded"), "false");

  const exportedBuffer = Buffer.from(JSON.stringify(document));
  await page.locator('input[type="file"]').setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await page.getByRole("alert").filter({ hasText: "not valid JSON" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "map.json", mimeType: "application/json", buffer: exportedBuffer });
  await page.getByRole("status").filter({ hasText: "Map imported successfully" }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "editor page overflows horizontally on a narrow viewport");
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join("\n")}`);
  console.log("EDITOR_E2E_PASS: /editor draw/collision/event/export/import/i18n/responsive");
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
